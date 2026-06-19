-- Registra motivo e data do último erro de pagamento (usado pelo webhook Asaas)
ALTER TABLE perfis
  ADD COLUMN IF NOT EXISTS pagamento_erro      text        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pagamento_erro_data timestamptz DEFAULT NULL;
