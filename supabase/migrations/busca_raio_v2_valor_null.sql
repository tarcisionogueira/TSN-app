-- Corrige divergência de filtro no modo RAIO (regra absoluta: mapa e lista devem
-- concordar). No caminho SEM raio, o filtro de valor só é aplicado quando definido
-- (q.gte/q.lte só entram se valorMin/valorMax existem) — então imóvel SEM preço
-- aparece quando não há filtro e some quando há. A RPC do raio incluía imóvel sem
-- preço SEMPRE (i.valor_minimo IS NULL OR ...), fazendo mapa (JS) e lista (RPC)
-- discordarem quando um filtro de preço estava ativo. Aqui igualamos o comportamento:
-- sem filtro (valor_min<=0 / valor_max no teto) inclui nulos; com filtro, exclui.
DROP FUNCTION IF EXISTS public.buscar_por_raio_v2(double precision, double precision, double precision, integer, integer, text[], text, text[], text[], double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.buscar_por_raio_v2(
  lat double precision, lng double precision, raio_metros double precision,
  lim integer DEFAULT 24, off integer DEFAULT 0,
  tipos_filtro text[] DEFAULT '{}'::text[], estado_filtro text DEFAULT ''::text,
  modalidades_filtro text[] DEFAULT '{}'::text[], pagamentos_filtro text[] DEFAULT '{}'::text[],
  valor_min double precision DEFAULT 0, valor_max double precision DEFAULT '9999999999'::bigint,
  desconto_min double precision DEFAULT 0)
 RETURNS TABLE(id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text, endereco text, valor_minimo double precision, valor_avaliacao double precision, desconto_percentual double precision, area_m2 double precision, latitude double precision, longitude double precision, link_foto text, url_lote text, data_leilao text, forma_pagamento text, fonte text, fonte_id text, score_financeiro integer, score_juridico integer, distancia_km double precision, total bigint)
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
      AND (cardinality(tipos_filtro) = 0 OR i.tipo = ANY(tipos_filtro) OR i.tipo = 'imovel')
      AND (estado_filtro = '' OR i.estado = estado_filtro)
      AND (cardinality(modalidades_filtro) = 0 OR i.modalidade = ANY(modalidades_filtro))
      AND (cardinality(pagamentos_filtro) = 0 OR i.forma_pagamento = ANY(pagamentos_filtro))
      AND (valor_min <= 0 OR (i.valor_minimo IS NOT NULL AND i.valor_minimo >= valor_min))
      AND (valor_max >= 9999999999 OR (i.valor_minimo IS NOT NULL AND i.valor_minimo <= valor_max))
      AND (desconto_min <= 0 OR (i.desconto_percentual IS NOT NULL AND i.desconto_percentual >= desconto_min))
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
