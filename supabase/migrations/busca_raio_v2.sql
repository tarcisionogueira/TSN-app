-- buscar_por_raio_v2 — versão da busca por raio que aceita TODOS os filtros simultâneos
-- (múltiplos tipos, múltiplas modalidades e múltiplas formas de pagamento) e retorna
-- o total de registros na área (para paginação correta na lista).
--
-- Motivação: a v1 só aceitava 1 tipo e 1 modalidade e ignorava forma de pagamento,
-- então no modo raio os filtros simultâneos (ex.: Financiado + Hipotecado) não eram
-- aplicados. A v1 é mantida por compatibilidade.
--
-- forma_pagamento no banco é sempre canônico: 'a_vista' | 'financiado' | 'hipotecado' | null.
-- Arrays vazios = "sem filtro" para a dimensão.

CREATE OR REPLACE FUNCTION public.buscar_por_raio_v2(
  lat double precision,
  lng double precision,
  raio_metros double precision,
  lim integer DEFAULT 24,
  off integer DEFAULT 0,
  tipos_filtro text[] DEFAULT '{}',
  estado_filtro text DEFAULT '',
  modalidades_filtro text[] DEFAULT '{}',
  pagamentos_filtro text[] DEFAULT '{}',
  valor_min double precision DEFAULT 0,
  valor_max double precision DEFAULT '9999999999'::bigint
)
RETURNS TABLE(
  id uuid, titulo text, tipo text, modalidade text, estado text, cidade text,
  bairro text, endereco text, valor_minimo double precision, valor_avaliacao double precision,
  desconto_percentual double precision, area_m2 double precision, latitude double precision,
  longitude double precision, link_foto text, url_lote text, data_leilao text,
  forma_pagamento text, fonte text, fonte_id text, score_financeiro integer,
  score_juridico integer, distancia_km double precision, total bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH filtrados AS (
    SELECT
      i.*,
      ROUND(CAST(
        earth_distance(
          ll_to_earth(i.latitude::float8, i.longitude::float8),
          ll_to_earth($1, $2)
        ) / 1000.0 AS numeric
      ), 1)::float8 AS distancia_km
    FROM imoveis_leilao i
    WHERE
      i.ativo = true
      AND i.latitude IS NOT NULL AND i.latitude != 0
      AND i.longitude IS NOT NULL AND i.longitude != 0
      AND earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(i.latitude::float8, i.longitude::float8)
      AND earth_distance(ll_to_earth(i.latitude::float8, i.longitude::float8), ll_to_earth($1, $2)) <= $3
      -- tipos: array vazio = sem filtro; inclui registros genéricos 'imovel' (igual à lista)
      AND (cardinality(tipos_filtro) = 0 OR i.tipo = ANY(tipos_filtro) OR i.tipo = 'imovel')
      AND (estado_filtro = '' OR i.estado = estado_filtro)
      AND (cardinality(modalidades_filtro) = 0 OR i.modalidade = ANY(modalidades_filtro))
      -- pagamento: união (Financiado + Hipotecado juntos retorna ambos)
      AND (cardinality(pagamentos_filtro) = 0 OR i.forma_pagamento = ANY(pagamentos_filtro))
      AND (i.valor_minimo IS NULL OR i.valor_minimo >= $10)
      AND (i.valor_minimo IS NULL OR i.valor_minimo <= $11)
  )
  SELECT
    f.id, f.titulo, f.tipo, f.modalidade, f.estado, f.cidade, f.bairro, f.endereco,
    f.valor_minimo::float8, f.valor_avaliacao::float8, f.desconto_percentual::float8, f.area_m2::float8,
    f.latitude::float8, f.longitude::float8, f.link_foto, COALESCE(f.url_lote, f.link_edital) AS url_lote,
    f.data_leilao, f.forma_pagamento, f.fonte, f.fonte_id, f.score_financeiro, f.score_juridico,
    f.distancia_km,
    (SELECT count(*) FROM filtrados) AS total
  FROM filtrados f
  ORDER BY f.distancia_km ASC
  LIMIT $4 OFFSET $5;
$function$;
