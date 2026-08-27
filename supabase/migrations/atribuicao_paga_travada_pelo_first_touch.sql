-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A ATRIBUIÇÃO FECHAVA A PORTA ANTES DO ANÚNCIO CHEGAR — 27/08/2026
--
-- Fui investigar "conversões zeradas nos dias de maior tráfego" e a suspeita original NÃO se
-- confirmou (ver o HANDOFF: o Google credita a conversão ao dia do CLIQUE e a ingestão reenvia
-- 7 dias, então dia a dia não é comparável, e 7 conversões em 20 dias é volume baixo demais
-- para ler padrão). O caminho, porém, levou a um defeito real e maior.
--
-- `registrar_marketing()` terminava assim:
--     mkt_capturado_em = coalesce(mkt_capturado_em, now())
--     ...
--     where id = auth.uid() and mkt_capturado_em is null;
--
-- A PRIMEIRA chamada carimba `mkt_capturado_em` e o `where` fecha a porta PARA SEMPRE. Como a
-- RPC roda em todo `SIGNED_IN`/`INITIAL_SESSION`, a primeira sessão de qualquer pessoa fecha
-- a porta — e desde a correção de 20/08 ("sem buraco negro") o first-touch SEMPRE grava algo,
-- nem que seja `referrer='direto'`. Resultado: quem visita organicamente primeiro nunca mais
-- consegue registrar um gclid, mesmo clicando no anúncio depois.
--
-- ⚠️ A INTENÇÃO DECLARADA E O CÓDIGO DIVERGIAM, no mesmo padrão da regra de saque de 08/08.
-- `src/utils/marketing.js` diz, em comentário:
--     "Chegou com anúncio → SOBRESCREVE sempre. É a atribuição que o Google Ads precisa para
--      contar a conversão. Quem visitou organicamente ontem e clicou no anúncio hoje tem que
--      ficar registrado como vindo do anúncio."
-- O localStorage sobrescrevia. O banco recusava.
--
-- MEDIDO, e a divisão é limpa:
--     primeiro toque 'direto'  →  16 perfis,  0 com gclid
--     primeiro toque 'google'  →   9 perfis,  8 com gclid
-- 27 perfis carimbados sem gclid.
--
-- 💸 O QUE ISSO CUSTA, e é o motivo de não ser só cosmético: `_webhook-core.js` só envia a
-- CONVERSÃO OFFLINE ao Google Ads quando `perfis.mkt_gclid` existe. Dos 7 pagantes,
-- **ZERO têm gclid** — ou seja, nenhuma venda jamais voltou para o Google. O Smart Bidding
-- vem otimizando sem ter visto um único desfecho de receita, e o "conversões" do painel nunca
-- mediu dinheiro.
--
-- DOIS CONSERTOS, porque são dois caminhos de perda diferentes.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ─── 1. ABRIR A PORTA ────────────────────────────────────────────────────────────────────
-- Todo SET já é `coalesce(campo_existente, novo)`: o first-touch de CADA campo continua
-- protegido individualmente, e nada que já foi gravado é sobrescrito. O `where` era, por
-- isso, redundante como proteção — ele só servia para impedir que um campo VAZIO fosse
-- preenchido depois, que é exatamente o caso do gclid que chega na segunda visita.
-- `mkt_capturado_em` segue marcando o PRIMEIRO toque, que é o que ele sempre significou.
create or replace function public.registrar_marketing(p jsonb)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or p is null then return false; end if;
  update public.perfis set
    mkt_gclid        = coalesce(mkt_gclid,        nullif(p->>'gclid','')),
    mkt_fbclid       = coalesce(mkt_fbclid,       nullif(p->>'fbclid','')),
    mkt_utm_source   = coalesce(mkt_utm_source,   nullif(p->>'utm_source','')),
    mkt_utm_medium   = coalesce(mkt_utm_medium,   nullif(p->>'utm_medium','')),
    mkt_utm_campaign = coalesce(mkt_utm_campaign, nullif(p->>'utm_campaign','')),
    mkt_referrer     = coalesce(mkt_referrer,     nullif(left(p->>'referrer', 120), '')),
    mkt_landing      = coalesce(mkt_landing,      nullif(left(p->>'landing',  200), '')),
    mkt_capturado_em = coalesce(mkt_capturado_em, now())
  where id = auth.uid();
  return found;
end $function$;


-- ─── 2. A REDE SERVIDOR, que não depende do localStorage ─────────────────────────────────
-- O conserto 1 só funciona se o navegador ainda tiver o `tsn_mkt`. Cookie limpo, outro
-- aparelho, ou o in-app browser do Instagram (que zera o referrer e isola o storage) perdem
-- o gclid mesmo com a porta aberta.
--
-- Mas o dado NÃO se perdeu: `visita_origem` guarda o gclid por `anon_id`, e
-- `eventos_atividade` liga `anon_id` a `user_id` (é o que `tracker.js` já grava). Esta função
-- casa os dois e preenche o gclid que faltava — server-side, sem depender do navegador.
--
-- LAST PAID TOUCH dentro da janela de 90 dias, que é o padrão do Google Ads: entre várias
-- visitas pagas do mesmo usuário, vale a mais recente. E só preenche o que está NULO —
-- atribuição já gravada nunca é mexida.
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
    mkt_utm_source   = coalesce(pf.mkt_utm_source,   m.utm_source),
    mkt_utm_medium   = coalesce(pf.mkt_utm_medium,   m.utm_medium),
    mkt_utm_campaign = coalesce(pf.mkt_utm_campaign, m.utm_campaign)
  from melhor m
  where pf.id = m.user_id
    and pf.mkt_gclid is null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.mkt_reconciliar_gclid() from public, anon, authenticated;
grant execute on function public.mkt_reconciliar_gclid() to service_role;


-- ─── 3. O VIGIA ──────────────────────────────────────────────────────────────────────────
-- Atribuição perdida não dá erro nenhum: o cadastro entra, a venda acontece, e o Google
-- simplesmente nunca fica sabendo. Conta quem AINDA está sem gclid tendo uma visita paga
-- alcançável pela ponte — ou seja, o que a reconciliação deveria ter resolvido e não
-- resolveu. Verde = 0.
create or replace function public.qa_invariantes_atribuicao_perdida()
returns bigint
language sql stable set search_path to 'public' as $function$
  select count(distinct pf.id)
    from public.perfis pf
    join (select distinct user_id, anon_id from public.eventos_atividade
           where anon_id is not null and user_id is not null) e on e.user_id = pf.id
    join public.visita_origem v on v.anon_id = e.anon_id
   where pf.mkt_gclid is null
     and v.gclid is not null
     and v.primeira_em > now() - interval '90 days';
$function$;

revoke all on function public.qa_invariantes_atribuicao_perdida() from public, anon;
grant execute on function public.qa_invariantes_atribuicao_perdida() to service_role, authenticated;

do $$
declare
  d      text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  ancora text := E'\n  )\n  select chave, titulo, categoria, gravidade,';
begin
  if position('atribuicao_paga_perdida' in d) > 0 then
    raise notice 'invariante ja presente'; return;
  end if;
  if position(ancora in d) = 0 then
    raise exception 'ancora nao encontrada em qa_invariantes() — abortando';
  end if;
  execute replace(d, ancora,
    E',\n'
    '     -- 27/08: gclid que existe na visita e nao chegou ao perfil. Sem ele a venda nunca\n'
    '     -- volta para o Google Ads, e o lance automatico otimiza sem ver receita.\n'
    '     (''atribuicao_paga_perdida'',''Cliente com visita paga cujo gclid nao chegou ao perfil'',''Ingestao'',''bug'',\n'
    '       public.qa_invariantes_atribuicao_perdida(), 0)'
    || ancora);
end $$;


-- ─── 4. BACKFILL do que a ponte alcança hoje ─────────────────────────────────────────────
select public.mkt_reconciliar_gclid() as perfis_recuperados;
