-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FILTRO "SEM LANCE" MOSTRAVA LEILÃO FUTURO — 28/09/2026 (print do dono: 36 imóveis, "Encerra
-- amanhã", "Encerra em 10 dias", com o filtro Sem lance ligado)
--
-- DUAS causas:
--  1. MODO RAIO ignorava o filtro: `buscar_por_raio_v2` (e a contagem sem geocode) não tinham
--     parâmetro de resultado — o filtro existia só no caminho SEM raio (aplicarFiltrosImoveis).
--     A regra do próprio código ("todo filtro vale nos dois caminhos") foi quebrada quando o
--     filtro nasceu (21/09). Agora `resultado_filtro` nas duas RPCs + api/busca-raio.js + front.
--  2. DADO CONTRADITÓRIO: 9 lotes (KLEILOES 7, FRANCOLEILOES 2) com resultado 'sem_lance' e praça
--     FUTURA — lote sem lance que voltou a leilão. O resultado antigo deixa de valer quando há
--     praça nova: gatilho zera resultado_leilao (sem_lance/indeterminado) se data_fim >= hoje.
--     Venda direta fica de fora: a regra da CAIXA (trg_cef_sem_lance_por_relistagem) marca
--     'sem_lance' justamente quando o imóvel volta como venda online, que pode ter data.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.resultado_invalida_com_praca_futura()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.resultado_leilao in ('sem_lance', 'indeterminado')
     and new.data_fim is not null and new.data_fim >= current_date
     and new.modalidade is distinct from 'venda_direta' then
    new.resultado_leilao := null;
    new.resultado_apuracao_tentativas := 0;
  end if;
  return new;
end $$;
-- Nome "zy": roda DEPOIS de trg_data_fim_leilao (que calcula data_fim) e antes de trg_zz_*.
drop trigger if exists trg_zy_resultado_vs_praca_futura on public.imoveis_leilao;
create trigger trg_zy_resultado_vs_praca_futura before insert or update on public.imoveis_leilao
  for each row execute function public.resultado_invalida_com_praca_futura();

update public.imoveis_leilao set resultado_leilao = null, resultado_apuracao_tentativas = 0
 where ativo and resultado_leilao in ('sem_lance', 'indeterminado') and data_fim >= current_date
   and modalidade is distinct from 'venda_direta';

-- RPCs do modo raio com `resultado_filtro` (assinatura nova; a antiga sai — duas versões com o
-- mesmo nome deixam o PostgREST sem saber qual chamar).
drop function if exists public.buscar_por_raio_v2(double precision,double precision,double precision,integer,integer,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text);
drop function if exists public.buscar_por_raio_v2_sem_geocode_count(text,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean);

CREATE OR REPLACE FUNCTION public.buscar_por_raio_v2(lat double precision, lng double precision, raio_metros double precision, lim integer DEFAULT 24, off integer DEFAULT 0, tipos_filtro text[] DEFAULT '{}'::text[], estado_filtro text DEFAULT ''::text, modalidades_filtro text[] DEFAULT '{}'::text[], pagamentos_filtro text[] DEFAULT '{}'::text[], valor_min double precision DEFAULT 0, valor_max double precision DEFAULT '9999999999'::bigint, desconto_min double precision DEFAULT 0, data_de text DEFAULT NULL::text, data_ate text DEFAULT NULL::text, sem_data boolean DEFAULT false, ordenacao text DEFAULT 'distancia'::text, resultado_filtro text DEFAULT ''::text)
 RETURNS TABLE(id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text, endereco text, valor_minimo double precision, valor_avaliacao double precision, desconto_percentual double precision, area_m2 double precision, latitude double precision, longitude double precision, link_foto text, url_lote text, data_leilao text, forma_pagamento text, fonte text, fonte_id text, score_financeiro integer, score_juridico integer, score_localizacao numeric, distancia_km double precision, total bigint, leiloeiro text, descricao text, link_edital text, link_matricula text, fracionado boolean, viavel boolean, score_viabilidade integer, numero_edital text, numero_matricula text, numero_processo text, valor_mercado numeric, analise_viavel boolean, valor_minimo_ref double precision, data_leilao_2 timestamp with time zone, data_fim date, praca1_fim timestamp with time zone, praca2_fim timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      and (i.fonte is distinct from 'EDITAL_DJEN' or coalesce(i.valor_minimo, 0) > 0)
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
      and (coalesce(resultado_filtro, '') = ''
           or (resultado_filtro = 'nao_apurado' and i.resultado_leilao is null)
           or (resultado_filtro not in ('', 'nao_apurado') and i.resultado_leilao = resultado_filtro))
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
  order by
    case when ordenacao = 'valor_asc'     then f.valor_minimo_ref  end asc  nulls last,
    case when ordenacao = 'desconto_desc' then f.desconto_percentual end desc nulls last,
    case when ordenacao = 'desconto_asc'  then f.desconto_percentual end asc  nulls last,
    case when ordenacao = 'data_asc'      then f.data_fim            end asc  nulls last,
    f.distancia_km asc,
    f.id asc
  limit $4 offset $5;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_por_raio_v2_sem_geocode_count(cidade_norm_filtro text, tipos_filtro text[] DEFAULT '{}'::text[], estado_filtro text DEFAULT ''::text, modalidades_filtro text[] DEFAULT '{}'::text[], pagamentos_filtro text[] DEFAULT '{}'::text[], valor_min double precision DEFAULT 0, valor_max double precision DEFAULT '9999999999'::bigint, desconto_min double precision DEFAULT 0, data_de text DEFAULT NULL::text, data_ate text DEFAULT NULL::text, sem_data boolean DEFAULT false, resultado_filtro text DEFAULT ''::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)
  from imoveis_leilao i
  where
    i.ativo = true
    and (i.fonte is distinct from 'EDITAL_DJEN' or coalesce(i.valor_minimo, 0) > 0)
    and (i.latitude is null or i.latitude = 0 or i.longitude is null or i.longitude = 0)
    and i.cidade_norm = cidade_norm_filtro
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
    and (coalesce(resultado_filtro, '') = ''
         or (resultado_filtro = 'nao_apurado' and i.resultado_leilao is null)
         or (resultado_filtro not in ('', 'nao_apurado') and i.resultado_leilao = resultado_filtro));
$function$;

-- Mesmas permissões de antes (a busca é pública: visitante anônimo usa o modo raio).
grant execute on function public.buscar_por_raio_v2(double precision,double precision,double precision,integer,integer,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text,text) to anon, authenticated, service_role;
grant execute on function public.buscar_por_raio_v2_sem_geocode_count(text,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text) to anon, authenticated, service_role;
