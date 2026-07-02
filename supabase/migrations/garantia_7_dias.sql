-- Âncora da PRIMEIRA assinatura paga (janela de arrependimento CDC art. 49).
-- Setada só na 1ª ativação; renovações não reiniciam a janela. Limpa no cancelamento.
ALTER TABLE perfis ADD COLUMN IF NOT EXISTS plano_pago_em timestamptz;
COMMENT ON COLUMN perfis.plano_pago_em IS 'Início da assinatura paga vigente. Base da garantia de 7 dias (CDC art. 49). NULL = sem assinatura paga ativa.';

-- Pedidos de reembolso da garantia de 7 dias (o estorno em si é conferido/executado
-- pelo admin no painel do gateway; aqui fica o registro auditável do direito exercido).
CREATE TABLE IF NOT EXISTS reembolsos_garantia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  nome          text,
  email         text,
  plano         text,
  valor_ref     numeric,
  gateway       text,
  status        text NOT NULL DEFAULT 'solicitado', -- solicitado | estornado | recusado
  motivo        text,
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  processado_por uuid
);
CREATE INDEX IF NOT EXISTS idx_reembolsos_status ON reembolsos_garantia(status, solicitado_em DESC);
ALTER TABLE reembolsos_garantia ENABLE ROW LEVEL SECURITY;
