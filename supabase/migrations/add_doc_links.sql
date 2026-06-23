-- Adiciona colunas de documentos: matrícula e regras de venda (Caixa venda direta)
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS link_matricula text DEFAULT NULL;
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS link_regras_venda text DEFAULT NULL;
