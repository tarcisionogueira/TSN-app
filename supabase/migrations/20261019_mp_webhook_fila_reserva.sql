-- 19/10 (pendência 255): a fila do webhook MP lia `pendente` sem reservar — duas rodadas sobrepostas
-- (> 60 s) pegavam o mesmo evento; a B via `duplicado` e marcava `processado`, e se a A falhava e
-- desfazia a marca de idempotência o evento se perdia. Cada rodada agora RESERVA a linha (PATCH
-- condicional com return=representation) e só processa o que conseguiu reservar.
alter table public.mp_webhook_fila add column if not exists reservado_ate timestamptz;
