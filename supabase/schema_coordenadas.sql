-- Adiciona coordenadas geográficas para busca por raio
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS latitude  numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

CREATE INDEX IF NOT EXISTS idx_imoveis_coords ON public.imoveis_leilao(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
