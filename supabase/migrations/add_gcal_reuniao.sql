-- ═══════════════════════════════════════════════════════════════════════
-- Integração Google Calendar nas reuniões (agendamento híbrido)
-- Guarda o id/link do evento criado na Google para permitir
-- atualização e cancelamento posteriores (propagação de remarcações).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.reunioes
  ADD COLUMN IF NOT EXISTS gcal_event_id text,
  ADD COLUMN IF NOT EXISTS gcal_html_link text;

COMMENT ON COLUMN public.reunioes.gcal_event_id IS
  'ID do evento no Google Calendar (para atualizar/cancelar o convite).';
