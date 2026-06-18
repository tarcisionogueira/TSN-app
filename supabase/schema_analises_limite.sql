-- Controle de limite de análises mensais por usuário (plano Investidor/top1 = 10/mês)
ALTER TABLE perfis
  ADD COLUMN IF NOT EXISTS analises_mes   text    DEFAULT NULL,  -- YYYY-MM do mês contabilizado
  ADD COLUMN IF NOT EXISTS analises_count integer DEFAULT 0;     -- quantidade no mês

-- Reseta o contador quando o mês muda (a aplicação já lida com isso,
-- mas esta função pode ser chamada via cron se necessário)
CREATE OR REPLACE FUNCTION resetar_analises_mes()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE perfis
  SET analises_count = 0, analises_mes = to_char(now(), 'YYYY-MM')
  WHERE analises_mes IS NOT NULL
    AND analises_mes < to_char(now(), 'YYYY-MM');
END;
$$;
