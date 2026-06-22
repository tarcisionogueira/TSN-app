-- Migração: adiciona nível de precisão da geocodificação
-- Executar no Supabase Dashboard → SQL Editor
ALTER TABLE imoveis_leilao
  ADD COLUMN IF NOT EXISTS geocod_nivel text DEFAULT NULL;
-- Valores: 'endereco' | 'bairro' | 'cidade' | null (não geocodificado)
-- 'endereco' = coordenada exata do imóvel
-- 'bairro'   = aproximado pelo bairro (raio ~500m no mapa)
-- 'cidade'   = aproximado pela cidade (raio ~2km no mapa)
COMMENT ON COLUMN imoveis_leilao.geocod_nivel IS
  'Precisão da geocodificação: endereco | bairro | cidade | null';
