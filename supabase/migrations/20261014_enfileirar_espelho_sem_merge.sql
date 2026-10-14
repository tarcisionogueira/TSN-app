-- 14/10 — espelhar-docs-cron: `enfileirar_espelho_documentos` estourou o statement_timeout (8 s) às 00h40.
-- Medido FORA do pico: 6,2 s, dos quais 5,5 s numa varredura completa do índice de documento_espelho
-- (115 mil linhas, 55 mil heap fetches) para um MERGE anti join. Com merge join desligado só nesta função,
-- o planner faz HASH anti join: 1,0 s. Configuração por função — nada muda no resto do banco.
alter function public.enfileirar_espelho_documentos(integer) set enable_mergejoin = off;
