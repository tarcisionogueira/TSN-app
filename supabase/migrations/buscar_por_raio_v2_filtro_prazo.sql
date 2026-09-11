-- Pedido do dono (11/09): filtro de prazo do leilão (este mês/próximo mês/próximo
-- trimestre/sem data) também no modo RAIO — regra absoluta já escrita no comentário de
-- aplicarFiltrosImoveis (Busca.jsx): todo filtro novo vale nos DOIS caminhos (lista direta
-- e raio via esta RPC), senão o modo raio silenciosamente ignora o filtro.
-- `data_leilao` é TEXT (formato ISO 'YYYY-MM-DD...'); comparação por TEXTO, não CAST para
-- date — um valor mal formado quebraria a query inteira com CAST, e a comparação textual já
-- é o que o cliente JS faz hoje (`.gte('data_leilao', iso)` via PostgREST, mesma coluna).
-- Parâmetros novos no FIM da assinatura (compatibilidade com chamadas antigas por posição).
create or replace function public.buscar_por_raio_v2(
  lat double precision, lng double precision, raio_metros double precision,
  lim integer default 24, off integer default 0,
  tipos_filtro text[] default '{}'::text[], estado_filtro text default ''::text,
  modalidades_filtro text[] default '{}'::text[], pagamentos_filtro text[] default '{}'::text[],
  valor_min double precision default 0, valor_max double precision default '9999999999'::bigint,
  desconto_min double precision default 0,
  data_de text default null, data_ate text default null, sem_data boolean default false
)
returns table(id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text, endereco text,
  valor_minimo double precision, valor_avaliacao double precision, desconto_percentual double precision, area_m2 double precision,
  latitude double precision, longitude double precision, link_foto text, url_lote text, data_leilao text, forma_pagamento text,
  fonte text, fonte_id text, score_financeiro integer, score_juridico integer, score_localizacao numeric, distancia_km double precision,
  total bigint, leiloeiro text, descricao text, link_edital text, link_matricula text, fracionado boolean, viavel boolean,
  score_viabilidade integer, numero_edital text, numero_matricula text, numero_processo text, valor_mercado numeric,
  analise_viavel boolean, valor_minimo_ref double precision, data_leilao_2 timestamp with time zone, data_fim date,
  praca1_fim timestamp with time zone, praca2_fim timestamp with time zone
)
language sql stable
set search_path to 'public'
as $function$
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
      AND (
        cardinality(pagamentos_filtro) = 0
        OR ((i.modalidade = 'judicial' OR i.forma_pagamento = 'hipotecado') AND 'hipotecado' = ANY(pagamentos_filtro))
        OR (i.modalidade IS DISTINCT FROM 'judicial' AND i.forma_pagamento = 'a_vista'   AND 'a_vista'    = ANY(pagamentos_filtro))
        OR (i.modalidade IS DISTINCT FROM 'judicial' AND i.forma_pagamento = 'financiado' AND 'financiado' = ANY(pagamentos_filtro))
      )
      AND (valor_min <= 0 OR (i.valor_minimo_ref IS NOT NULL AND i.valor_minimo_ref >= valor_min))
      AND (valor_max >= 9999999999 OR (i.valor_minimo_ref IS NOT NULL AND i.valor_minimo_ref <= valor_max))
      AND (desconto_min <= 0 OR (i.desconto_percentual IS NOT NULL AND i.desconto_percentual >= desconto_min))
      AND (
        (sem_data AND i.data_leilao IS NULL)
        OR (NOT sem_data
            AND (data_de IS NULL OR (i.data_leilao IS NOT NULL AND i.data_leilao >= data_de))
            AND (data_ate IS NULL OR (i.data_leilao IS NOT NULL AND i.data_leilao <= data_ate)))
      )
  )
  SELECT
    f.id, f.titulo, f.tipo, f.modalidade, f.estado, f.cidade, f.bairro, f.endereco,
    f.valor_minimo::float8, f.valor_avaliacao::float8, f.desconto_percentual::float8, f.area_m2::float8,
    f.latitude::float8, f.longitude::float8, f.link_foto, COALESCE(f.url_lote, f.link_edital) AS url_lote,
    f.data_leilao, f.forma_pagamento, f.fonte, f.fonte_id, f.score_financeiro, f.score_juridico,
    f.score_localizacao,
    f.distancia_km,
    (SELECT count(*) FROM filtrados) AS total,
    f.leiloeiro, f.descricao, f.link_edital, f.link_matricula, f.fracionado, f.viavel,
    f.score_viabilidade, f.numero_edital, f.numero_matricula, f.numero_processo,
    f.valor_mercado, f.analise_viavel,
    f.valor_minimo_ref::float8, f.data_leilao_2, f.data_fim, f.praca1_fim, f.praca2_fim
  FROM filtrados f
  ORDER BY f.distancia_km ASC
  LIMIT $4 OFFSET $5;
$function$;
