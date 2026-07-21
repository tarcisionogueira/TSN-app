-- Radar de Editais — PRECISÃO + IA (refino após validar a captura via Bright Data).
-- Achado da validação: a busca por texto no DJEN traz MUITO despacho/decisão que só CITA
-- "leilão" (de 612 comunicações, só ~14-30 eram editais reais). O parser por regex extraía
-- lixo em leiloeiro/avaliação. Correção em 2 frentes:
--   1) filtro DURO na ingestão (só edital de leilão real entra) — no código do cron;
--   2) extração por IA (Gemini-primário/Claude-fallback) só nos editais reais — barato porque
--      são poucos. Esta flag evita reprocessar (idempotente) e controla custo.
alter table public.editais_leilao
  add column if not exists ia_extraido boolean not null default false;

-- Índice parcial: a fila de enriquecimento por IA busca "editais ainda não extraídos" a cada
-- run; o índice deixa a varredura barata mesmo com a tabela crescendo.
create index if not exists idx_editais_ia_pendente
  on public.editais_leilao (data_disponibilizacao desc)
  where ia_extraido = false;
