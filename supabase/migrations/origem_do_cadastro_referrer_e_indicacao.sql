-- ============================================================================
-- DE ONDE VEIO ESTE CADASTRO? (11/08) — a pergunta do dono, e por que hoje ela
-- não tem resposta para a maioria das pessoas.
--
-- Estado medido nos últimos 14 dias (17 cadastros):
--   • 5  → Google Ads, com `gclid`. Atribuição real.
--   • 2  → indicação de parceiro de verdade (link `?ref=`).
--   • 10 → `indicado_por` = o DONO. E isso NÃO quer dizer que ele indicou.
--
-- É `vincular_owner_default`: quem chega SEM link de parceiro recebe o dono como
-- upline padrão. A intenção é de negócio (ninguém fica órfão de carteira) e está
-- certa. O problema é que o resultado é indistinguível de uma indicação real —
-- o dono também divulga o próprio link. Ou seja: "origem desconhecida" estava
-- vestida de "indicado pelo dono", e a tela do admin repetia isso de boa-fé.
-- É a família de sempre: o vazio entregue como resposta.
--
-- Duas correções, e a segunda é a que realmente responde a pergunta:
--
-- 1. `indicacao_origem` — REGISTRA COMO o upline foi definido, em vez de deixar
--    deduzir. 'link_parceiro' | 'padrao_dono' | 'promo' | 'sdr' | 'manual'.
--
-- 2. `mkt_referrer` / `mkt_landing` — hoje a captura só grava quando existe
--    gclid/fbclid/utm na URL. Quem chega do Instagram, de um grupo de WhatsApp,
--    da busca orgânica ou digitando o endereço não deixa rastro NENHUM. Guardar
--    o HOST de origem e a página de entrada explica boa parte dos 10 acima.
--    Só o host (`instagram.com`), nunca a URL inteira: o caminho de onde a
--    pessoa veio pode conter dado de terceiro e não acrescenta nada aqui.
--
-- ⚠️ Não recupera o passado. Os 10 já cadastrados continuam sem origem — nenhuma
-- migração inventa dado que nunca foi coletado. Vale a partir de agora.
-- ============================================================================

alter table public.perfis
  add column if not exists indicacao_origem text,
  add column if not exists mkt_referrer     text,
  add column if not exists mkt_landing      text;

comment on column public.perfis.indicacao_origem is
  'COMO o indicado_por foi definido: link_parceiro | padrao_dono | promo | sdr | manual. '
  'Existe porque o upline padrão (dono) era indistinguível de uma indicação real dele.';
comment on column public.perfis.mkt_referrer is
  'Host de onde o visitante chegou (ex.: instagram.com, google.com) ou "direto". Só o host.';

-- ── 1. O padrão passa a se identificar como padrão ──────────────────────────
create or replace function public.vincular_owner_default()
returns boolean language plpgsql security definer set search_path to 'public' as $fn$
declare v_owner uuid := '92c713f3-1f1a-4758-bab2-32e6c83da433'; -- dono (upline padrão)
begin
  if auth.uid() is null then return false; end if;
  update public.perfis
     set indicado_por = v_owner,
         ultima_indicacao_em = now(),
         -- O CARIMBO É O PONTO DESTA MIGRAÇÃO: sem ele, este update produz uma linha
         -- idêntica à de quem foi mesmo indicado pelo dono.
         indicacao_origem = 'padrao_dono'
   where id = auth.uid()
     and indicado_por is null
     and id <> v_owner
     and role not in ('admin','analista','advogado','consultor');
  return found;
end; $fn$;

-- ── 2. Atribuição aceita referrer/landing e passa a gravar SEMPRE ───────────
-- Antes só gravava se viesse gclid/fbclid/utm. Agora a chegada orgânica/direta
-- também deixa rastro — que é justamente o caso dos 10 sem origem.
create or replace function public.registrar_marketing(p jsonb)
returns boolean language plpgsql security definer set search_path to 'public' as $fn$
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
  where id = auth.uid()
    -- FIRST-TOUCH continua valendo, mas o gatilho passa a ser "ainda não sei nada
    -- sobre a origem" em vez de "ainda não sei nada sobre o ANÚNCIO".
    and mkt_capturado_em is null;
  return found;
end $fn$;

revoke execute on function public.registrar_marketing(jsonb) from public, anon;
grant  execute on function public.registrar_marketing(jsonb) to authenticated;

-- ── 3. A leitura que responde a pergunta em uma linha ───────────────────────
create or replace function public.origem_dos_cadastros(p_dias int default 30)
returns table(origem text, cadastros bigint, primeiro timestamptz, ultimo timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select case
           when p.mkt_gclid  is not null then 'Google Ads'
           when p.mkt_fbclid is not null then 'Meta Ads'
           when coalesce(p.mkt_utm_source,'') <> '' then 'UTM: ' || p.mkt_utm_source
           when p.indicacao_origem = 'link_parceiro' then 'Indicação (link de parceiro)'
           when p.indicacao_origem in ('promo','sdr')  then 'Consultor / promo'
           when coalesce(p.mkt_referrer,'') not in ('', 'direto') then 'Veio de ' || p.mkt_referrer
           when p.mkt_referrer = 'direto' then 'Direto (digitou ou salvou o link)'
           -- Tudo que sobra é honestamente DESCONHECIDO. Antes isto aparecia como
           -- "indicado pelo dono", que é uma resposta errada com cara de certa.
           else 'Origem não identificada'
         end as origem,
         count(*),
         min(p.created_at),
         max(p.created_at)
    from perfis p
   where p.created_at > now() - make_interval(days => p_dias)
     and p.role not in ('admin','analista','advogado','consultor')
   group by 1
   order by 2 desc;
$$;
revoke execute on function public.origem_dos_cadastros(int) from public, anon;
grant  execute on function public.origem_dos_cadastros(int) to authenticated, service_role;
