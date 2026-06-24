-- Tabela para registrar resultado de healthchecks de integrações externas
CREATE TABLE IF NOT EXISTS system_health (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  servico    text NOT NULL,          -- 'onr_digital', 'resend', 'asaas', etc.
  ok         boolean NOT NULL,
  detalhe    text,
  criado_em  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_health_servico ON system_health(servico, criado_em DESC);

-- Só admin lê; service role escreve (via cron)
ALTER TABLE system_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_admin_read" ON system_health
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'));

-- Mantém apenas os últimos 90 registros por serviço (evita crescimento infinito)
CREATE OR REPLACE FUNCTION limpar_system_health() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM system_health
  WHERE servico = NEW.servico
    AND id NOT IN (
      SELECT id FROM system_health
      WHERE servico = NEW.servico
      ORDER BY criado_em DESC
      LIMIT 90
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_limpar_system_health ON system_health;
CREATE TRIGGER trg_limpar_system_health
  AFTER INSERT ON system_health
  FOR EACH ROW EXECUTE FUNCTION limpar_system_health();
