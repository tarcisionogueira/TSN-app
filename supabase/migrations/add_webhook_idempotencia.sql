-- ════════════════════════════════════════════════════════════════════════════
-- Idempotência de webhooks de pagamento (MP / Asaas)
-- Rodar no SQL Editor do Supabase. Aditivo e idempotente.
--
-- Problema: os gateways REENVIAM a mesma notificação (retries, múltiplos
-- disparos do mesmo evento). Sem trava, um mesmo pagamento podia reprocessar
-- (reemitir NFS-e, reavaliar plano, etc.). A tabela abaixo registra cada
-- (gateway, evento, payment_id) já tratado; o insert é a própria trava.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.webhook_eventos_processados (
  gateway            text        NOT NULL,           -- 'mercadopago' | 'asaas'
  gateway_payment_id text        NOT NULL,           -- id do pagamento no gateway
  evento             text        NOT NULL,           -- status/tipo do evento (approved, PAYMENT_CONFIRMED, ...)
  processado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gateway, gateway_payment_id, evento)
);

-- Só o servidor (service_role) escreve/lê; ninguém mais.
ALTER TABLE public.webhook_eventos_processados ENABLE ROW LEVEL SECURITY;
-- Sem POLICY → nenhum acesso via anon/authenticated; service_role ignora RLS.
