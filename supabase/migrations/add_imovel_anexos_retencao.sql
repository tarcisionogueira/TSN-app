-- Adiciona campos de retenção em imovel_anexos para controle de limpeza após 90 dias
ALTER TABLE imovel_anexos
  ADD COLUMN IF NOT EXISTS storage_path text,          -- caminho no bucket 'documentos'
  ADD COLUMN IF NOT EXISTS data_leilao date,           -- data do leilão (para contar 90 dias)
  ADD COLUMN IF NOT EXISTS arrematado boolean NOT NULL DEFAULT false,  -- se arrematou, mantém
  ADD COLUMN IF NOT EXISTS origem_url text;            -- URL original de onde o arquivo foi baixado

-- Índice para o cron de limpeza
CREATE INDEX IF NOT EXISTS idx_imovel_anexos_limpeza
  ON imovel_anexos (data_leilao, arrematado)
  WHERE arrematado = false AND data_leilao IS NOT NULL;

-- Separação de cotas por tipo de análise em cotas_analise
ALTER TABLE cotas_analise
  ADD COLUMN IF NOT EXISTS analises_mercado_usadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analises_mercado_limite integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS analises_documental_usadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS analises_documental_limite integer NOT NULL DEFAULT 0;

-- Comentários
COMMENT ON COLUMN imovel_anexos.storage_path IS 'Caminho no bucket documentos. Se preenchido, o arquivo está armazenado no Supabase Storage.';
COMMENT ON COLUMN imovel_anexos.data_leilao   IS 'Data do leilão — usado pelo cron de limpeza para calcular os 90 dias.';
COMMENT ON COLUMN imovel_anexos.arrematado    IS 'Se true, o arquivo não é apagado pelo cron de retenção.';
COMMENT ON COLUMN imovel_anexos.origem_url    IS 'URL original de onde o arquivo foi baixado (log de auditoria).';
