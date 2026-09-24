-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FIPE: CACHE DAS RESPOSTAS DA API — 24/09/2026
--
-- A cota grátis (500/dia, teto nosso 450) esgotava TODO dia e enriquecia ~45 veículos: o cron
-- rebaixava as mesmas listas de marcas/modelos a cada execução e fazia 1 chamada de `/years`
-- para cada um dos ~40 modelos "CG" da Honda. Resultado: 178 de 7.580 veículos com FIPE.
-- A FIPE atualiza 1x/mês; guardamos cada resposta útil por caminho da API e o cron (e a busca
-- sob demanda) só gasta cota no que nunca viu. Validade de 25 dias = `RETENTAR_OK_DIAS`.
-- Só service_role lê/grava (RLS ligada, sem política).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.fipe_cache (
  path       text primary key,
  resposta   jsonb not null,
  obtido_em  timestamptz not null default now()
);
alter table public.fipe_cache enable row level security;
revoke all on public.fipe_cache from anon, authenticated;
