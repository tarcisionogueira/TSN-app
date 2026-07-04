-- Índice de localização (0-10) calculado sobre a coordenada PRECISA do imóvel
-- (geocod_nivel=endereco) a partir das proximidades OSM, com distance-decay.
-- Preenchido pelo job scripts/enriquecer-osm.mjs (workflow enriquecer-osm.yml).
ALTER TABLE public.imoveis_leilao ADD COLUMN IF NOT EXISTS score_localizacao numeric;
COMMENT ON COLUMN public.imoveis_leilao.score_localizacao IS
  'Indice de localizacao 0-10 (proximidades OSM, distance-decay) calculado sobre a coordenada precisa do imovel (geocod_nivel=endereco).';
