-- Habilita extensão earthdistance (nativa do Postgres, sem custo adicional)
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Índice nas coordenadas para acelerar buscas por bbox e raio
CREATE INDEX IF NOT EXISTS idx_imoveis_lat_lng
  ON imoveis_leilao (latitude, longitude)
  WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0;

-- Função RPC: busca por raio usando earthdistance
-- Retorna imóveis dentro do raio com distância calculada no banco
CREATE OR REPLACE FUNCTION buscar_por_raio(
  lat float8,
  lng float8,
  raio_metros float8,
  lim int DEFAULT 24,
  off int DEFAULT 0,
  tipo_filtro text DEFAULT '',
  estado_filtro text DEFAULT '',
  modalidade_filtro text DEFAULT '',
  valor_min float8 DEFAULT 0,
  valor_max float8 DEFAULT 9999999999
)
RETURNS TABLE (
  id uuid,
  titulo text,
  tipo text,
  modalidade text,
  estado text,
  cidade text,
  bairro text,
  endereco text,
  valor_minimo float8,
  valor_avaliacao float8,
  desconto_percentual float8,
  area_m2 float8,
  latitude float8,
  longitude float8,
  link_foto text,
  url_lote text,
  data_leilao text,
  forma_pagamento text,
  fonte text,
  fonte_id text,
  score_financeiro int,
  score_juridico int,
  distancia_km float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    i.id,
    i.titulo,
    i.tipo,
    i.modalidade,
    i.estado,
    i.cidade,
    i.bairro,
    i.endereco,
    i.valor_minimo,
    i.valor_avaliacao,
    i.desconto_percentual,
    i.area_m2,
    i.latitude,
    i.longitude,
    i.link_foto,
    COALESCE(i.url_lote, i.link_edital) AS url_lote,
    i.data_leilao,
    i.forma_pagamento,
    i.fonte,
    i.fonte_id,
    i.score_financeiro,
    i.score_juridico,
    ROUND(CAST(
      earth_distance(
        ll_to_earth(i.latitude, i.longitude),
        ll_to_earth($1, $2)
      ) / 1000.0 AS numeric
    ), 1)::float8 AS distancia_km
  FROM imoveis_leilao i
  WHERE
    i.ativo = true
    AND i.latitude IS NOT NULL AND i.latitude != 0
    AND i.longitude IS NOT NULL AND i.longitude != 0
    AND earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(i.latitude, i.longitude)
    AND earth_distance(ll_to_earth(i.latitude, i.longitude), ll_to_earth($1, $2)) <= $3
    AND ($6 = '' OR i.tipo = $6)
    AND ($7 = '' OR i.estado = $7)
    AND ($8 = '' OR i.modalidade = $8)
    AND (i.valor_minimo IS NULL OR i.valor_minimo >= $9)
    AND (i.valor_minimo IS NULL OR i.valor_minimo <= $10)
  ORDER BY distancia_km ASC
  LIMIT $4 OFFSET $5;
$$;

-- Permissão para anon/authenticated chamarem via API
GRANT EXECUTE ON FUNCTION buscar_por_raio TO anon, authenticated;
