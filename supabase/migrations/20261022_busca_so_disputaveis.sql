-- BUSCA SÓ COM O QUE DÁ PARA DISPUTAR (22/10, pedido do dono): "os leilões vencidos mantenha somente
-- os sem lance e que sejam identificados somente com o filtro e não na busca aberta". Mesma regra de
-- aplicarFiltrosImoveis (src/pages/Busca.jsx): fora do filtro 'sem_lance', só entra lote com
-- data_fim (último prazo, 2ª praça inclusa) de hoje em diante ou sem data (venda direta).
-- Corpo idêntico ao vigente em 22/10, mais a última condição do WHERE.
CREATE OR REPLACE FUNCTION public.buscar_por_raio_v2(lat double precision, lng double precision, raio_metros double precision, lim integer DEFAULT 24, off integer DEFAULT 0, tipos_filtro text[] DEFAULT '{}'::text[], estado_filtro text DEFAULT ''::text, modalidades_filtro text[] DEFAULT '{}'::text[], pagamentos_filtro text[] DEFAULT '{}'::text[], valor_min double precision DEFAULT 0, valor_max double precision DEFAULT '9999999999'::bigint, desconto_min double precision DEFAULT 0, data_de text DEFAULT NULL::text, data_ate text DEFAULT NULL::text, sem_data boolean DEFAULT false, ordenacao text DEFAULT 'distancia'::text, resultado_filtro text DEFAULT ''::text)
 RETURNS TABLE(id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text, endereco text, valor_minimo double precision, valor_avaliacao double precision, desconto_percentual double precision, area_m2 double precision, latitude double precision, longitude double precision, link_foto text, url_lote text, data_leilao text, forma_pagamento text, fonte text, fonte_id text, score_financeiro integer, score_juridico integer, score_localizacao numeric, distancia_km double precision, total bigint, leiloeiro text, descricao text, link_edital text, link_matricula text, fracionado boolean, viavel boolean, score_viabilidade integer, numero_edital text, numero_matricula text, numero_processo text, valor_mercado numeric, analise_viavel boolean, valor_minimo_ref double precision, data_leilao_2 timestamp with time zone, data_fim date, praca1_fim timestamp with time zone, praca2_fim timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with filtrados as (
    select i.id, i.valor_minimo_ref, i.desconto_percentual, i.data_fim,
      round(cast(earth_distance(ll_to_earth(i.latitude::float8, i.longitude::float8), ll_to_earth($1, $2)) / 1000.0 as numeric), 1)::float8 as distancia_km
    from public.imoveis_leilao i
    where i.ativo = true
      and (i.fonte is distinct from 'EDITAL_DJEN' or coalesce(i.valor_minimo, 0) > 0)
      and i.latitude is not null and i.latitude != 0 and i.longitude is not null and i.longitude != 0
      and earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(i.latitude::float8, i.longitude::float8)
      and earth_distance(ll_to_earth(i.latitude::float8, i.longitude::float8), ll_to_earth($1, $2)) <= $3
      and (cardinality(tipos_filtro) = 0 or i.tipo = any(tipos_filtro) or i.tipo = 'imovel')
      and (estado_filtro = '' or i.estado = estado_filtro)
      and (cardinality(modalidades_filtro) = 0 or i.modalidade = any(modalidades_filtro))
      and (cardinality(pagamentos_filtro) = 0
        or ((i.modalidade = 'judicial' or i.forma_pagamento = 'hipotecado') and 'hipotecado' = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'a_vista' and 'a_vista' = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'financiado' and 'financiado' = any(pagamentos_filtro)))
      and (valor_min <= 0 or (i.valor_minimo_ref is not null and i.valor_minimo_ref >= valor_min))
      and (valor_max >= 9999999999 or (i.valor_minimo_ref is not null and i.valor_minimo_ref <= valor_max))
      and (desconto_min <= 0 or (i.desconto_percentual is not null and i.desconto_percentual >= desconto_min))
      and ((sem_data and i.data_leilao is null) or (not sem_data
            and (data_de is null or (i.data_leilao is not null and i.data_leilao >= data_de))
            and (data_ate is null or (i.data_leilao is not null and i.data_leilao <= data_ate))))
      and (coalesce(resultado_filtro, '') = '' or (resultado_filtro = 'nao_apurado' and i.resultado_leilao is null)
           or (resultado_filtro not in ('', 'nao_apurado') and i.resultado_leilao = resultado_filtro))
      and (resultado_filtro = 'sem_lance' or i.data_fim is null
           or i.data_fim >= (now() at time zone 'America/Sao_Paulo')::date)
  ),
  pagina as (
    select f.*, (select count(*) from filtrados) as total from filtrados f
     order by case when ordenacao = 'valor_asc' then f.valor_minimo_ref end asc nulls last,
       case when ordenacao = 'desconto_desc' then f.desconto_percentual end desc nulls last,
       case when ordenacao = 'desconto_asc' then f.desconto_percentual end asc nulls last,
       case when ordenacao = 'data_asc' then f.data_fim end asc nulls last, f.distancia_km asc, f.id asc
     limit $4 offset $5)
  select v.id, v.titulo, v.tipo, v.modalidade, v.estado, v.cidade, v.bairro, v.endereco,
    v.valor_minimo::float8, v.valor_avaliacao::float8, v.desconto_percentual::float8, v.area_m2::float8,
    v.latitude::float8, v.longitude::float8, v.link_foto, coalesce(v.url_lote, v.link_edital) as url_lote,
    v.data_leilao, v.forma_pagamento, v.fonte, v.fonte_id, v.score_financeiro, v.score_juridico, v.score_localizacao,
    p.distancia_km, p.total, v.leiloeiro, v.descricao, v.link_edital, v.link_matricula, v.fracionado, v.viavel,
    v.score_viabilidade, v.numero_edital, v.numero_matricula, v.numero_processo, v.valor_mercado, v.analise_viavel,
    v.valor_minimo_ref::float8, v.data_leilao_2, v.data_fim, v.praca1_fim, v.praca2_fim
  from pagina p join public.imoveis_leilao_mascarado v on v.id = p.id
  order by case when ordenacao = 'valor_asc' then p.valor_minimo_ref end asc nulls last,
    case when ordenacao = 'desconto_desc' then p.desconto_percentual end desc nulls last,
    case when ordenacao = 'desconto_asc' then p.desconto_percentual end asc nulls last,
    case when ordenacao = 'data_asc' then p.data_fim end asc nulls last, p.distancia_km asc, p.id asc;
$function$;
