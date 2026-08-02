-- Reentrega do webhook do Daily duplicava a transcrição (e o custo do aprendizado).
--
-- `api/daily-webhook.js` fazia INSERT direto de `transcription-ready` sem nenhuma chave de
-- idempotência. Webhook reentrega em timeout/5xx — e logo depois do insert o endpoint chama
-- `extrairLicoes()` (Gemini, pago), então cada reentrega duplicava a transcrição na ficha da
-- reunião E pagava a extração de lições de novo, poluindo as tabelas de aprendizado com o
-- mesmo conteúdo. É uma reunião por sala: `daily_room_name` é a chave natural.
--
-- Índice ÚNICO (não só um "confere antes de inserir"): retentativa concorrente do webhook
-- perderia a corrida do check-then-insert. Com o índice, o `on_conflict do nothing` do
-- endpoint é decidido pelo banco. Hoje a tabela está vazia — nenhum backfill necessário.
create unique index if not exists transcricoes_reuniao_room_uidx
  on public.transcricoes_reuniao (daily_room_name)
  where daily_room_name is not null;

comment on index public.transcricoes_reuniao_room_uidx is
  'Uma transcrição por sala do Daily — torna a reentrega do webhook idempotente (api/daily-webhook.js).';
