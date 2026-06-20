-- Imóveis arrematados são mantidos permanentemente para histórico
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS arrematado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_arrematacao timestamptz;

-- Índice para consultas de histórico
CREATE INDEX IF NOT EXISTS idx_imoveis_arrematado ON public.imoveis_leilao(arrematado) WHERE arrematado = true;
