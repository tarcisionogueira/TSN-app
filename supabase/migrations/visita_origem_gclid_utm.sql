-- ─────────────────────────────────────────────────────────────────────────────
-- ORIGEM DA VISITA — primeiro toque (gclid + UTM). (12/08, pedido do dono sobre o Ads)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR QUE: hoje sabemos QUANTOS chegam, não DE QUAL anúncio/palavra. A query string era
-- descartada em todo o caminho — o tracker manda só o `pathname`. Sem o `gclid` não existe
-- medição de Ads de verdade, e sobretudo não existe o passo seguinte: devolver a conversão
-- ao Google (Offline Conversion Import) para ele otimizar por VALOR real, e não por clique.
--
-- FIRST TOUCH de propósito: o cadastro costuma acontecer em outra página, às vezes noutro dia.
-- É o clique que TROUXE a pessoa que deve levar o crédito — por isso `anon_id` é a chave e a
-- gravação nunca sobrescreve (ver o Prefer: resolution=ignore-duplicates em api/track.js).
--
-- A ponte com o cliente já existe e é o mesmo `anon_id` (`bp_aid`) que o Cliente 360 usa:
-- quando a pessoa cria conta, `eventos_atividade` passa a ter user_id + anon_id na mesma
-- linha, e daí sai "esta conta veio da campanha X".
create table if not exists public.visita_origem (
  anon_id       text primary key,
  gclid         text,
  gbraid        text,
  wbraid        text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  referrer_host text,
  landing       text,
  primeira_em   timestamptz not null default now()
);

comment on table public.visita_origem is
  'Primeiro toque do visitante anônimo: gclid/UTM da URL de chegada. Ponte para o Cliente 360 pelo anon_id (o mesmo bp_aid do tracker). Escrita só por service_role via /api/track.';

create index if not exists visita_origem_gclid_idx on public.visita_origem (gclid) where gclid is not null;
create index if not exists visita_origem_campanha_idx on public.visita_origem (utm_campaign) where utm_campaign is not null;

alter table public.visita_origem enable row level security;
-- Sem policy para anon/authenticated: leitura só por service_role (backend) e pelas RPCs
-- admin-gated. É dado de aquisição, não é do usuário final.
revoke all on public.visita_origem from anon, authenticated;
grant select, insert, update on public.visita_origem to service_role;
