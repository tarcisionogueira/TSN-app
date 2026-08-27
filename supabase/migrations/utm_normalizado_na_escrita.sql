-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O MESMO CANAL CONTADO COM DOIS NOMES — 27/08/2026
--
-- Investigando a origem dos cadastros do dia, o relatório de canais aparecia fragmentado:
--
--     utm_source    'instagram' 154   ·  'ig' 7          ← mesma fonte, dois nomes
--     utm_campaign  'TRF - SITE - LEILOES - AGO26' 136   ·  'TRF+-+SITE+-+LEILOES+-+AGO26' 4
--
-- Nenhum dos dois é bug de código: são links montados à mão (bio do Instagram, criativo da
-- campanha). O `+` é o encoding de espaço em query string que sobreviveu por ter vindo
-- duplo-codificado (`%2B`), então `URLSearchParams` o entregou como `+` literal.
--
-- ⚠️ POR QUE NORMALIZAR NA ESCRITA, E NÃO SÓ NOS LINKS QUE NÓS GERAMOS. Consertar apenas o
-- que a plataforma emite deixaria de fora justamente a origem do problema — o link da bio,
-- que é digitado fora daqui e vai continuar sendo. Normalizar na ENTRADA vale para qualquer
-- link, presente ou futuro, sem depender de ninguém lembrar da convenção. É o mesmo caminho
-- do gatilho que barra o placeholder de foto (25/08): conserto na CLASSE, não nas linhas.
--
-- REGRAS, deliberadamente conservadoras — só o que o dado prova:
--   • source/medium: trim + minúsculas (são identificadores de canal, caixa não é conteúdo);
--   • campaign/content/term: só `+`→espaço e trim. A CAIXA É PRESERVADA, porque aqui o valor
--     é nome próprio e aparece em relatório — rebaixar "REEL-2408-PASSO-A-PASSO" para
--     minúsculas destruiria informação para arrumar um problema que não existe.
--   • um único apelido: `ig` → `instagram`. Os 7 registros de `ig` têm
--     `utm_content = 'link_in_bio'`, os mesmos da bio gravada como `instagram`.
--
-- O QUE NÃO FOI TOCADO, de propósito:
--   • `chatgpt.com` como utm_source — não é erro: o ChatGPT carimba assim os links que cita.
--   • `utm_medium` 'bio' (14) × 'social' (7) — são dois padrões de link da bio, um antigo e
--     um novo. Fundir exigiria adivinhar a intenção; fica sinalizado no HANDOFF.
--   • `pesquisa-leilao` (6) × `pesquisa-leilao-imoveis` (5) em `perfis` — pode ser renomeação
--     real de campanha no Google Ads, não variação de escrita. Idem.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Canal (source/medium): minúsculas + apelidos conhecidos.
create or replace function public.mkt_norm_canal(v text)
returns text language sql immutable set search_path to 'public' as $$
  select case lower(btrim(replace(coalesce(v, ''), '+', ' ')))
           when ''   then null
           when 'ig' then 'instagram'
           else lower(btrim(replace(v, '+', ' ')))
         end;
$$;

-- Rótulo (campaign/content/term): só desfaz o encoding. Preserva a caixa.
create or replace function public.mkt_norm_rotulo(v text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(btrim(replace(coalesce(v, ''), '+', ' ')), '');
$$;


-- ─── GATILHO na entrada das visitas ──────────────────────────────────────────────────────
create or replace function public.tg_visita_origem_normaliza()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.utm_source   := public.mkt_norm_canal(new.utm_source);
  new.utm_medium   := public.mkt_norm_canal(new.utm_medium);
  new.utm_campaign := public.mkt_norm_rotulo(new.utm_campaign);
  new.utm_content  := public.mkt_norm_rotulo(new.utm_content);
  new.utm_term     := public.mkt_norm_rotulo(new.utm_term);
  return new;
end $$;

drop trigger if exists trg_visita_origem_normaliza on public.visita_origem;
create trigger trg_visita_origem_normaliza
  before insert or update on public.visita_origem
  for each row execute function public.tg_visita_origem_normaliza();


-- ─── A MESMA NORMALIZAÇÃO NO CADASTRO ────────────────────────────────────────────────────
-- `perfis.mkt_*` vem por outro caminho (localStorage → RPC), então precisa da regra também —
-- senão o relatório de VISITAS fica limpo e o de CADASTROS continua fragmentado, que é a
-- pior das duas situações: dois painéis discordando sobre o mesmo canal.
-- Mantém a porta aberta do conserto anterior (`where id = auth.uid()`, sem trava de
-- `mkt_capturado_em`) — ver `atribuicao_paga_travada_pelo_first_touch.sql`.
create or replace function public.registrar_marketing(p jsonb)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or p is null then return false; end if;
  update public.perfis set
    mkt_gclid        = coalesce(mkt_gclid,        nullif(p->>'gclid','')),
    mkt_fbclid       = coalesce(mkt_fbclid,       nullif(p->>'fbclid','')),
    mkt_utm_source   = coalesce(mkt_utm_source,   public.mkt_norm_canal(p->>'utm_source')),
    mkt_utm_medium   = coalesce(mkt_utm_medium,   public.mkt_norm_canal(p->>'utm_medium')),
    mkt_utm_campaign = coalesce(mkt_utm_campaign, public.mkt_norm_rotulo(p->>'utm_campaign')),
    mkt_referrer     = coalesce(mkt_referrer,     nullif(left(p->>'referrer', 120), '')),
    mkt_landing      = coalesce(mkt_landing,      nullif(left(p->>'landing',  200), '')),
    mkt_capturado_em = coalesce(mkt_capturado_em, now())
  where id = auth.uid();
  return found;
end $function$;


-- ─── E NA RECONCILIAÇÃO ──────────────────────────────────────────────────────────────────
-- Ela copia utm de `visita_origem` para `perfis`. A partir do gatilho acima a origem já vem
-- normalizada, mas as linhas ANTIGAS não — e é justamente delas que a reconciliação lê.
create or replace function public.mkt_reconciliar_gclid()
returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare v_n integer;
begin
  with ponte as (
    select distinct e.user_id, e.anon_id
      from public.eventos_atividade e
     where e.anon_id is not null and e.user_id is not null
  ),
  melhor as (
    select distinct on (p.user_id)
           p.user_id, v.gclid, v.utm_source, v.utm_medium, v.utm_campaign
      from ponte p
      join public.visita_origem v on v.anon_id = p.anon_id
     where v.gclid is not null
       and v.primeira_em > now() - interval '90 days'
     order by p.user_id, v.primeira_em desc
  )
  update public.perfis pf set
    mkt_gclid        = coalesce(pf.mkt_gclid,        m.gclid),
    mkt_utm_source   = coalesce(pf.mkt_utm_source,   public.mkt_norm_canal(m.utm_source)),
    mkt_utm_medium   = coalesce(pf.mkt_utm_medium,   public.mkt_norm_canal(m.utm_medium)),
    mkt_utm_campaign = coalesce(pf.mkt_utm_campaign, public.mkt_norm_rotulo(m.utm_campaign))
  from melhor m
  where pf.id = m.user_id
    and pf.mkt_gclid is null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;


-- ─── BACKFILL do que já está gravado ─────────────────────────────────────────────────────
update public.visita_origem set
  utm_source   = public.mkt_norm_canal(utm_source),
  utm_medium   = public.mkt_norm_canal(utm_medium),
  utm_campaign = public.mkt_norm_rotulo(utm_campaign),
  utm_content  = public.mkt_norm_rotulo(utm_content),
  utm_term     = public.mkt_norm_rotulo(utm_term)
where utm_source   is distinct from public.mkt_norm_canal(utm_source)
   or utm_medium   is distinct from public.mkt_norm_canal(utm_medium)
   or utm_campaign is distinct from public.mkt_norm_rotulo(utm_campaign)
   or utm_content  is distinct from public.mkt_norm_rotulo(utm_content)
   or utm_term     is distinct from public.mkt_norm_rotulo(utm_term);

update public.perfis set
  mkt_utm_source   = public.mkt_norm_canal(mkt_utm_source),
  mkt_utm_medium   = public.mkt_norm_canal(mkt_utm_medium),
  mkt_utm_campaign = public.mkt_norm_rotulo(mkt_utm_campaign)
where mkt_utm_source   is distinct from public.mkt_norm_canal(mkt_utm_source)
   or mkt_utm_medium   is distinct from public.mkt_norm_canal(mkt_utm_medium)
   or mkt_utm_campaign is distinct from public.mkt_norm_rotulo(mkt_utm_campaign);

-- ─── HISTÓRICO: nome-do-disparo que estava em SOURCE ─────────────────────────────────────
-- `email_alerta`/`email_ativacao` iam como utm_source (ver `api/_utm.js`). Agora o disparo
-- vive em `utm_campaign` e o source é o canal. Move o que já foi gravado, senão fica um
-- canal órfão ao lado do novo — a mesma fragmentação que esta migração existe para acabar.
update public.visita_origem
   set utm_campaign = coalesce(utm_campaign, replace(utm_source, 'email_', '')),
       utm_medium   = coalesce(utm_medium, 'email'),
       utm_source   = 'email'
 where utm_source in ('email_alerta','email_ativacao');

update public.perfis
   set mkt_utm_campaign = coalesce(mkt_utm_campaign, replace(mkt_utm_source, 'email_', '')),
       mkt_utm_medium   = coalesce(mkt_utm_medium, 'email'),
       mkt_utm_source   = 'email'
 where mkt_utm_source in ('email_alerta','email_ativacao');
