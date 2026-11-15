-- 15/11 — ÍNDICE COM UM CORPUS SÓ (arena de 15/11, P0; pendência #484).
--
-- Havia duas tabelas: `indice_amostra` (singular, 4.899 linhas, lida pela consulta, composição, valorização,
-- estado) e `indice_amostras` (plural, 1.280, lida pelo ponderado, pelos bairros e pelas regiões mapeadas). A
-- gravação escrevia nas duas; a limpeza de links de 15/11 só alcançou a singular (80 redirecionadores expirados
-- seguiam na plural), e as duas davam números diferentes (Santana de Parnaíba +18,7%, Cotia +17,4%, Salvador −19,4%).
--
-- COORDENADA SÓ VALE SE NÓS A GEOCODIFICAMOS. Medido em 15/11: 992 de 1.247 coordenadas da singular estavam
-- empilhadas na coordenada do IMÓVEL ANALISADO (o relatório carimba quando a IA DECLARA "mesmo condomínio/rua"), e o
-- nível "≤250 m" contava esse carimbo como vizinhança. Agora a distância só usa lat/lng com
-- `coord_origem = 'geocodificada'` — gravado pelo indice-geocodificar-cron SÓ no sucesso (a falha grava geocod_em
-- e nada mais; usar geocod_em como marcador daria selo a carimbo antigo).
--
-- Não apaga nada: a plural fica congelada (sem escrita nova). REVOKE INSERT e DROP ficam com o dono (pendência).

alter table public.indice_amostra add column if not exists cep text;
alter table public.indice_amostra add column if not exists geocod_em timestamptz;
alter table public.indice_amostra add column if not exists geo_nivel text;
alter table public.indice_amostra add column if not exists coord_origem text;
comment on column public.indice_amostra.coord_origem is
  'geocodificada = posição calculada por nós (indice-geocodificar-cron); null = sem prova (inclui o carimbo do relatório). Só geocodificada entra em distância.';
create index if not exists ix_indice_amostra_geocod_fila on public.indice_amostra (criado_em desc)
  where geocod_em is null and (cep is not null or endereco is not null or condominio is not null);

-- 1) Coordenadas REAIS e CEP da plural para o espelho na singular (o espelho é a linha com fonte = fonte_ref).
update public.indice_amostra s
   set lat = p.lat, lng = p.lng, geocod_em = p.geocod_em, geo_nivel = p.geo_nivel, coord_origem = 'geocodificada',
       cep = coalesce(s.cep, p.cep)
  from public.indice_amostras p
 where s.cidade_norm = p.cidade_norm and s.uf = p.uf and s.fonte = p.fonte_ref
   and p.lat is not null and p.lng is not null and p.geocod_em is not null;
update public.indice_amostra s set cep = p.cep
  from public.indice_amostras p
 where s.cidade_norm = p.cidade_norm and s.uf = p.uf and s.fonte = p.fonte_ref and s.cep is null and p.cep is not null;

-- 2) As linhas da plural SEM espelho (13 em 15/11). Redirecionador do grounding expira: entra sem link.
insert into public.indice_amostra (cidade_norm, uf, bairro_norm, geo_grid, tipo, especie, valor_m2, valor_total, area_m2,
    data_ref, fonte, origem, lat, lng, url, endereco, condominio, cep, geocod_em, geo_nivel, coord_origem)
select p.cidade_norm, p.uf, coalesce(p.bairro_norm, ''), '', p.tipo, p.natureza, p.valor_m2,
       case when p.area_m2 > 0 then round(p.valor_m2 * p.area_m2, 2) end, p.area_m2,
       coalesce(p.data_anuncio, p.criado_em::date), p.fonte_ref, 'portal',
       case when p.geocod_em is not null then p.lat end, case when p.geocod_em is not null then p.lng end,
       case when p.url ~ 'vertexaisearch\.cloud\.google\.com' then null else p.url end,
       p.endereco, p.condominio, p.cep, p.geocod_em, p.geo_nivel,
       case when p.lat is not null and p.geocod_em is not null then 'geocodificada' end
  from public.indice_amostras p
 where p.natureza in ('venda', 'locacao') and p.valor_m2 > 0
   and not exists (select 1 from public.indice_amostra s where s.cidade_norm = p.cidade_norm and s.uf = p.uf
                    and (s.fonte = p.fonte_ref or (p.url is not null and s.url = p.url)))
on conflict do nothing;

-- 3) Gravação: só a singular. Mesmo contrato (devolve quantas entraram).
create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;
  with novas as (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf,
      nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      a->>'tipo' tipo, lower(a->>'natureza') natureza,
      nullif(a->>'valor_m2','')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'data_anuncio','')::date data_anuncio,
      nullif(a->>'fonte_ref','') fonte_ref,
      nullif(a->>'cep','') cep, nullif(a->>'endereco','') endereco,
      nullif(a->>'condominio','') condominio, nullif(a->>'url','') url
    from jsonb_array_elements(p_amostras) a
  ),
  validas as (
    select * from novas
    where cidade_norm is not null and uf is not null and valor_m2 is not null and valor_m2 > 0
      and natureza in ('venda','locacao')
      and public.indice_amostra_tem_ancora(endereco, condominio, cep, bairro_norm)
  ),
  ins as (
    insert into public.indice_amostra (cidade_norm, uf, bairro_norm, geo_grid, tipo, especie,
        valor_m2, valor_total, area_m2, data_ref, fonte, origem, url, endereco, condominio, cep)
    select n.cidade_norm, n.uf, coalesce(n.bairro_norm,''), '', n.tipo, n.natureza, n.valor_m2,
           case when n.area_m2 > 0 then round(n.valor_m2 * n.area_m2, 2) end,
           n.area_m2, coalesce(n.data_anuncio, current_date), n.fonte_ref, 'portal',
           n.url, n.endereco, n.condominio, n.cep
    from validas n
    where n.url is null or not exists (select 1 from public.indice_amostra x where x.url = n.url)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$function$;

-- 4) Leituras: singular, com especie/data_ref, e distância só com coordenada geocodificada.
create or replace function public.indice_regiao_ponderado(p_cidade_norm text, p_uf text, p_bairro_norm text, p_lat double precision, p_lng double precision, p_tipo text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cid text := lower(coalesce(p_cidade_norm,'')); v_uf text := upper(coalesce(p_uf,''));
  v_bai text := nullif(lower(coalesce(p_bairro_norm,'')),''); v_tipo text := lower(coalesce(p_tipo,''));
  v_min int := 5;
  v_res jsonb := '{}'::jsonb;
begin
  with base as (
    select especie as natureza, valor_m2,
      1.0 / (1.0 + greatest(0, (current_date - coalesce(data_ref, current_date - 365)))::numeric / 365.0) as peso,
      case
        when p_lat is not null and p_lng is not null and coord_origem = 'geocodificada' and lat is not null and lng is not null
          then 111320.0 * sqrt( power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2) )
        else null end as dist_m,
      (v_bai is not null and bairro_norm = v_bai) as mesmo_bairro
    from public.indice_amostra
    where cidade_norm = v_cid and uf = v_uf and tipo = v_tipo
      and public.indice_plausivel(v_tipo, especie, valor_m2)
  ),
  niveis as (
    select natureza, valor_m2, peso,
      case
        when (dist_m is not null and dist_m <= 250) or mesmo_bairro then 1
        when (dist_m is not null and dist_m <= 1000) then 2
        else 3 end as nivel
    from base
  ),
  cont as (select natureza, nivel, count(*) n from niveis group by natureza, nivel),
  escolha as (
    select distinct on (natureza) natureza, nivel
    from (select c.*, sum(n) over (partition by c.natureza order by nivel) as acum from cont c) t
    where acum >= v_min or nivel = 3
    order by natureza, nivel
  ),
  pctl as (
    select n2.natureza, e.nivel as nivel_escolhido,
      percentile_cont(0.10) within group (order by n2.valor_m2) as p10,
      percentile_cont(0.25) within group (order by n2.valor_m2) as p25,
      percentile_cont(0.50) within group (order by n2.valor_m2) as p50,
      percentile_cont(0.75) within group (order by n2.valor_m2) as p75,
      percentile_cont(0.90) within group (order by n2.valor_m2) as p90,
      count(*) as n
    from escolha e join niveis n2 on n2.natureza = e.natureza and n2.nivel <= e.nivel
    group by n2.natureza, e.nivel
  ),
  agreg as (
    select p.natureza, p.nivel_escolhido, p.p25, p.p50, p.p75, p.n,
      sum(n3.valor_m2*n3.peso) filter (where n3.valor_m2 between p.p10 and p.p90) as svp,
      sum(n3.peso)             filter (where n3.valor_m2 between p.p10 and p.p90) as sp
    from pctl p join niveis n3 on n3.natureza = p.natureza and n3.nivel <= p.nivel_escolhido
    group by p.natureza, p.nivel_escolhido, p.p10, p.p90, p.p25, p.p50, p.p75, p.n
  )
  select jsonb_build_object(
    'venda_m2',    (select round(svp/nullif(sp,0), 2) from agreg where natureza='venda'),
    'locacao_m2',  (select round(svp/nullif(sp,0), 2) from agreg where natureza='locacao'),
    'venda_pop',   (select round(p25::numeric) from agreg where natureza='venda'),
    'venda_med',   (select round(p50::numeric) from agreg where natureza='venda'),
    'venda_alto',  (select round(p75::numeric) from agreg where natureza='venda'),
    'locacao_med', (select round(p50::numeric, 2) from agreg where natureza='locacao'),
    'n_venda',     coalesce((select n from agreg where natureza='venda'), 0),
    'n_locacao',   coalesce((select n from agreg where natureza='locacao'), 0),
    'nivel',       coalesce((select nivel_escolhido from agreg where natureza='venda'),
                            (select nivel_escolhido from agreg where natureza='locacao')),
    'cidade_norm', v_cid, 'uf', v_uf, 'tipo', v_tipo
  ) into v_res;
  return v_res;
end; $function$;

create or replace function public.indice_bairros_cidade(p_cidade_norm text, p_uf text, p_tipo text)
returns table(bairro_norm text, venda_m2 numeric, locacao_m2 numeric, venda_pop numeric, venda_alto numeric, n_venda integer, n_locacao integer)
language sql stable security definer set search_path to 'public' as $function$
  with base as (
    select bairro_norm, especie as natureza, valor_m2,
      1.0 / (1.0 + greatest(0, (current_date - coalesce(data_ref, current_date - 365)))::numeric / 365.0) as peso
    from public.indice_amostra
    where cidade_norm = lower(coalesce(p_cidade_norm,''))
      and uf = upper(coalesce(p_uf,''))
      and tipo = lower(coalesce(p_tipo,''))
      and bairro_norm is not null and bairro_norm <> ''
      and public.indice_plausivel(lower(coalesce(p_tipo,'')), especie, valor_m2)
  ),
  pctl as (
    select bairro_norm, natureza,
      percentile_cont(0.10) within group (order by valor_m2) as p10,
      percentile_cont(0.25) within group (order by valor_m2) as p25,
      percentile_cont(0.75) within group (order by valor_m2) as p75,
      percentile_cont(0.90) within group (order by valor_m2) as p90
    from base group by bairro_norm, natureza
  ),
  j as (
    select b.bairro_norm, b.natureza, b.valor_m2, b.peso, p.p10, p.p90, p.p25, p.p75
    from base b join pctl p on p.bairro_norm = b.bairro_norm and p.natureza = b.natureza
  )
  select j.bairro_norm,
    round(sum(valor_m2*peso) filter (where natureza='venda'   and valor_m2 between p10 and p90) / nullif(sum(peso) filter (where natureza='venda'   and valor_m2 between p10 and p90),0), 2) as venda_m2,
    round(sum(valor_m2*peso) filter (where natureza='locacao' and valor_m2 between p10 and p90) / nullif(sum(peso) filter (where natureza='locacao' and valor_m2 between p10 and p90),0), 2) as locacao_m2,
    round(max(p25) filter (where natureza='venda')) as venda_pop,
    round(max(p75) filter (where natureza='venda')) as venda_alto,
    count(*) filter (where natureza='venda')::int   as n_venda,
    count(*) filter (where natureza='locacao')::int as n_locacao
  from j
  group by j.bairro_norm
  having count(*) filter (where natureza='venda') >= 3
  order by count(*) filter (where natureza='venda') desc
  limit 60;
$function$;

create or replace function public.indice_regioes_mapeadas(p_limite integer default 40)
returns table(cidade_norm text, uf text, n_amostras integer, tipos text)
language sql stable security definer set search_path to 'public' as $function$
  select cidade_norm, uf, count(*)::int as n_amostras, string_agg(distinct tipo, ',') as tipos
  from public.indice_amostra
  where cidade_norm is not null and cidade_norm <> '' and uf is not null
  group by cidade_norm, uf
  having count(*) >= 3
  order by count(*) desc
  limit greatest(1, least(p_limite, 200));
$function$;

-- 5) Composição: "localidade (≤250 m)" só com coordenada geocodificada.
create or replace function public.indice_composicao(p_cidade_norm text, p_uf text, p_bairro_norm text, p_lat double precision, p_lng double precision, p_tipo text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cid text := lower(coalesce(p_cidade_norm,'')); v_uf text := upper(coalesce(p_uf,''));
  v_bai text := nullif(lower(coalesce(p_bairro_norm,'')),''); v_tipo text := lower(coalesce(p_tipo,''));
  v_res jsonb;
begin
  with cid as (
    select valor_m2, bairro_norm, case when coord_origem = 'geocodificada' then lat end lat, case when coord_origem = 'geocodificada' then lng end lng
    from public.indice_amostra
    where cidade_norm=v_cid and uf=v_uf and tipo=v_tipo and especie='venda'
      and public.indice_plausivel(v_tipo,'venda',valor_m2)
  ),
  terc as (
    select percentile_cont(0.33) within group (order by valor_m2) t1,
           percentile_cont(0.66) within group (order by valor_m2) t2 from cid
  )
  select jsonb_build_object(
    'localidade', jsonb_build_object('raio_m', 250, 'n', (
       select count(*) from cid where p_lat is not null and p_lng is not null and lat is not null and lng is not null
         and 111320.0*sqrt(power(lat-p_lat,2)+power((lng-p_lng)*cos(radians(p_lat)),2)) <= 250)),
    'bairro', jsonb_build_object('n', (select count(*) from cid where v_bai is not null and bairro_norm=v_bai)),
    'cidade', jsonb_build_object('n', (select count(*) from cid),
                                 'n_bairros', (select count(distinct bairro_norm) from cid where bairro_norm is not null and bairro_norm<>'')),
    'estado', (select jsonb_build_object('n', count(*), 'n_cidades', count(distinct cidade_norm))
               from public.indice_amostra where uf=v_uf and tipo=v_tipo and especie='venda' and public.indice_plausivel(v_tipo,'venda',valor_m2)),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from (
        select tipo, count(*) n from public.indice_amostra
        where cidade_norm=v_cid and uf=v_uf and especie='venda' and tipo is not null group by tipo) t), '{}'::jsonb),
    'por_padrao', (select jsonb_build_object(
        'popular', count(*) filter (where valor_m2 <  (select t1 from terc)),
        'medio',   count(*) filter (where valor_m2 >= (select t1 from terc) and valor_m2 < (select t2 from terc)),
        'alto',    count(*) filter (where valor_m2 >= (select t2 from terc))) from cid),
    'tipo', v_tipo, 'uf', v_uf
  ) into v_res;
  return v_res;
end; $function$;
