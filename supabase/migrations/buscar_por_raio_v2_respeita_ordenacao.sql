-- 17/09: achado do dono — "Menor valor primeiro" (e as outras opções do dropdown de
-- ordenação da Busca) não fazia NADA no modo raio (busca por proximidade): a tela
-- mandava `sortAtivo` só pro modo normal (`.order(coluna, {ascending: dir})`,
-- Busca.jsx); `api/busca-raio.js` nunca recebia nem repassava a ordenação, e
-- `buscar_por_raio_v2` tinha `ORDER BY f.distancia_km ASC` FIXO no SQL — não existia
-- parâmetro nenhum de ordenação pra essa RPC. Resultado: no modo raio, a lista sempre
-- saía por distância, e o dropdown mentia sobre o que estava sendo exibido.
--
-- Corrige adicionando `ordenacao text DEFAULT 'distancia'` e um ORDER BY dinâmico —
-- mesmas 4 opções que o modo normal já suporta (valor_asc, desconto_desc, desconto_asc,
-- data_asc), com distância como critério padrão e desempate final (faz sentido numa
-- busca por proximidade: só desempata quem ordenou por outra coisa).
--
-- Substitui as DUAS assinaturas antigas (12 e 15 parâmetros — a de 12 já estava órfã
-- desde que `data_de/data_ate/sem_data` foram adicionados sem dropar a versão anterior;
-- ninguém mais chama nenhuma delas, só `api/busca-raio.js`, sempre com todos os
-- parâmetros nomeados).
drop function if exists public.buscar_por_raio_v2(
  double precision, double precision, double precision, integer, integer,
  text[], text, text[], text[], double precision, double precision, double precision
);
drop function if exists public.buscar_por_raio_v2(
  double precision, double precision, double precision, integer, integer,
  text[], text, text[], text[], double precision, double precision, double precision,
  text, text, boolean
);

create or replace function public.buscar_por_raio_v2(
  lat double precision,
  lng double precision,
  raio_metros double precision,
  lim integer default 24,
  off integer default 0,
  tipos_filtro text[] default '{}'::text[],
  estado_filtro text default ''::text,
  modalidades_filtro text[] default '{}'::text[],
  pagamentos_filtro text[] default '{}'::text[],
  valor_min double precision default 0,
  valor_max double precision default '9999999999'::bigint,
  desconto_min double precision default 0,
  data_de text default null::text,
  data_ate text default null::text,
  sem_data boolean default false,
  ordenacao text default 'distancia'::text
)
returns table(
  id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text,
  endereco text, valor_minimo double precision, valor_avaliacao double precision,
  desconto_percentual double precision, area_m2 double precision, latitude double precision,
  longitude double precision, link_foto text, url_lote text, data_leilao text,
  forma_pagamento text, fonte text, fonte_id text, score_financeiro integer,
  score_juridico integer, score_localizacao numeric, distancia_km double precision,
  total bigint, leiloeiro text, descricao text, link_edital text, link_matricula text,
  fracionado boolean, viavel boolean, score_viabilidade integer, numero_edital text,
  numero_matricula text, numero_processo text, valor_mercado numeric,
  analise_viavel boolean, valor_minimo_ref double precision,
  data_leilao_2 timestamp with time zone, data_fim date,
  praca1_fim timestamp with time zone, praca2_fim timestamp with time zone
)
language sql
stable
set search_path to 'public'
as $function$
  with filtrados as (
    select
      i.*,
      round(cast(
        earth_distance(
          ll_to_earth(i.latitude::float8, i.longitude::float8),
          ll_to_earth($1, $2)
        ) / 1000.0 as numeric
      ), 1)::float8 as distancia_km
    from imoveis_leilao i
    where
      i.ativo = true
      and i.latitude is not null and i.latitude != 0
      and i.longitude is not null and i.longitude != 0
      and earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(i.latitude::float8, i.longitude::float8)
      and earth_distance(ll_to_earth(i.latitude::float8, i.longitude::float8), ll_to_earth($1, $2)) <= $3
      and (cardinality(tipos_filtro) = 0 or i.tipo = any(tipos_filtro) or i.tipo = 'imovel')
      and (estado_filtro = '' or i.estado = estado_filtro)
      and (cardinality(modalidades_filtro) = 0 or i.modalidade = any(modalidades_filtro))
      and (
        cardinality(pagamentos_filtro) = 0
        or ((i.modalidade = 'judicial' or i.forma_pagamento = 'hipotecado') and 'hipotecado' = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'a_vista'   and 'a_vista'    = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'financiado' and 'financiado' = any(pagamentos_filtro))
      )
      and (valor_min <= 0 or (i.valor_minimo_ref is not null and i.valor_minimo_ref >= valor_min))
      and (valor_max >= 9999999999 or (i.valor_minimo_ref is not null and i.valor_minimo_ref <= valor_max))
      and (desconto_min <= 0 or (i.desconto_percentual is not null and i.desconto_percentual >= desconto_min))
      and (
        (sem_data and i.data_leilao is null)
        or (not sem_data
            and (data_de is null or (i.data_leilao is not null and i.data_leilao >= data_de))
            and (data_ate is null or (i.data_leilao is not null and i.data_leilao <= data_ate)))
      )
  )
  select
    f.id, f.titulo, f.tipo, f.modalidade, f.estado, f.cidade, f.bairro, f.endereco,
    f.valor_minimo::float8, f.valor_avaliacao::float8, f.desconto_percentual::float8, f.area_m2::float8,
    f.latitude::float8, f.longitude::float8, f.link_foto, coalesce(f.url_lote, f.link_edital) as url_lote,
    f.data_leilao, f.forma_pagamento, f.fonte, f.fonte_id, f.score_financeiro, f.score_juridico,
    f.score_localizacao,
    f.distancia_km,
    (select count(*) from filtrados) as total,
    f.leiloeiro, f.descricao, f.link_edital, f.link_matricula, f.fracionado, f.viavel,
    f.score_viabilidade, f.numero_edital, f.numero_matricula, f.numero_processo,
    f.valor_mercado, f.analise_viavel,
    f.valor_minimo_ref::float8, f.data_leilao_2, f.data_fim, f.praca1_fim, f.praca2_fim
  from filtrados f
  -- Só a coluna do modo escolhido entra com valor não-nulo; as outras ficam NULL pra
  -- toda linha (não desempatam nada) e a distância sempre fecha como critério final.
  order by
    case when ordenacao = 'valor_asc'     then f.valor_minimo_ref  end asc  nulls last,
    case when ordenacao = 'desconto_desc' then f.desconto_percentual end desc nulls last,
    case when ordenacao = 'desconto_asc'  then f.desconto_percentual end asc  nulls last,
    case when ordenacao = 'data_asc'      then f.data_fim            end asc  nulls last,
    f.distancia_km asc
  limit $4 offset $5;
$function$;
