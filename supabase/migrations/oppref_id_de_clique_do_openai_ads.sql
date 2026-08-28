-- ─────────────────────────────────────────────────────────────────────────────────────────
-- `oppref` — O ID DE CLIQUE DO OPENAI ADS (ChatGPT Ads), 28/08
--
-- É o gclid deles: vem na URL de destino do anúncio e o próprio pixel o guarda no cookie
-- `__oppref`. Capturamos por conta própria pelo MESMO motivo do gclid e do fbclid — para a
-- origem existir no NOSSO banco mesmo quando o pixel está bloqueado, dormente ou o visitante
-- não chega a cadastrar. Sem coluna, o `oppref` que o navegador já lê morreria no caminho:
-- código escrito que não chega ao banco é a forma #7 catalogada no CLAUDE.md.
--
-- Duas tabelas, como o par gclid/fbclid: `visita_origem` (primeiro toque por dispositivo) e
-- `perfis.mkt_oppref` (atribuição do cadastro).
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.visita_origem add column if not exists oppref text;
alter table public.perfis        add column if not exists mkt_oppref text;

comment on column public.visita_origem.oppref is
  'ID de clique do OpenAI Ads (ChatGPT Ads), o equivalente ao gclid. Vem na URL do anuncio.';
comment on column public.perfis.mkt_oppref is
  'ID de clique do OpenAI Ads no primeiro toque do cadastro (first-touch, como mkt_gclid).';

create index if not exists idx_visita_origem_oppref on public.visita_origem(oppref) where oppref is not null;

-- `registrar_marketing` passa a gravar o oppref. Mesma regra de FIRST-TOUCH das demais: só
-- preenche quando ainda não sabemos nada da origem (`mkt_capturado_em is null`), para a
-- primeira campanha que trouxe a pessoa continuar levando o crédito.
create or replace function public.registrar_marketing(p jsonb)
returns boolean language plpgsql security definer set search_path to 'public' as $fn$
begin
  if auth.uid() is null or p is null then return false; end if;
  update public.perfis set
    mkt_gclid        = coalesce(mkt_gclid,        nullif(p->>'gclid','')),
    mkt_fbclid       = coalesce(mkt_fbclid,       nullif(p->>'fbclid','')),
    mkt_oppref       = coalesce(mkt_oppref,       nullif(p->>'oppref','')),
    mkt_utm_source   = coalesce(mkt_utm_source,   nullif(p->>'utm_source','')),
    mkt_utm_medium   = coalesce(mkt_utm_medium,   nullif(p->>'utm_medium','')),
    mkt_utm_campaign = coalesce(mkt_utm_campaign, nullif(p->>'utm_campaign','')),
    mkt_referrer     = coalesce(mkt_referrer,     nullif(left(p->>'referrer', 120), '')),
    mkt_landing      = coalesce(mkt_landing,      nullif(left(p->>'landing',  200), '')),
    mkt_capturado_em = coalesce(mkt_capturado_em, now())
  where id = auth.uid()
    and mkt_capturado_em is null;
  return found;
end $fn$;

revoke execute on function public.registrar_marketing(jsonb) from public, anon;
grant  execute on function public.registrar_marketing(jsonb) to authenticated;
