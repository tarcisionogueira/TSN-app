-- ÍNDICE FIEL: banda de PADRÃO (popular/médio/alto) + rejeição de OUTLIER + sanidade por TIPO.
--
-- Problema (achado 27/07, relatórios de BH/Barueri): o índice fazia MÉDIA PONDERADA SIMPLES sobre
-- TODAS as amostras do tipo, sem separar padrão e sem aparar extremos → Alphaville (R$18k/m²) e
-- popular (R$2,5k/m²) viravam um R$/m² blendado (~R$6.921) que não precifica nem um nem outro; o
-- número ainda oscilava 2-3× entre buscas. E a ingestão só validava R$/m² por NATUREZA (venda
-- 200–200000), então R$260/m² de "apartamento" (terreno mal-rotulado ou área errada) ENTRAVA.
--
-- Correção (retrocompatível — mantém os campos antigos e ACRESCENTA bandas):
--   1) indice_plausivel(tipo,natureza,valor): faixa de R$/m² PLAUSÍVEL por TIPO (barra outlier).
--   2) ingerir_amostras_indice: passa a exigir plausibilidade POR TIPO (não entra mais lixo).
--   3) indice_regiao_ponderado / indice_bairros_cidade: (a) ignoram amostra implausível por tipo,
--      (b) aparam extremos [p10..p90] antes da média ponderada (headline robusto), (c) devolvem as
--      BANDAS de padrão venda_pop=p25 / venda_med=p50 / venda_alto=p75 para precificar pelo padrão
--      do imóvel-alvo em vez de um número blendado.
-- NÃO apaga amostra existente (append-only preservado): o lixo é apenas IGNORADO na leitura.

-- 1) Faixa plausível de R$/m² por tipo (centraliza a régua; usada na ingestão e na leitura).
create or replace function public.indice_plausivel(p_tipo text, p_natureza text, p_valor numeric)
returns boolean language sql immutable as $function$
  select case
    when p_valor is null or p_valor <= 0 then false
    when lower(coalesce(p_natureza,'')) = 'locacao' then
      case lower(coalesce(p_tipo,''))
        when 'terreno' then p_valor between 0.1 and 100      -- R$/m²/mês de terreno é baixíssimo
        else p_valor between 3 and 500 end
    else -- venda (R$/m²)
      case lower(coalesce(p_tipo,''))
        when 'apartamento' then p_valor between 800 and 60000
        when 'casa'        then p_valor between 600 and 50000
        when 'comercial'   then p_valor between 400 and 80000
        when 'terreno'     then p_valor between 20 and 20000  -- terreno tem R$/m² baixo (normal)
        else p_valor between 200 and 200000 end               -- desconhecido: faixa ampla legada
  end;
$function$;

-- 2) Ingestão: dedup por (natureza,fonte_ref) + PLAUSIBILIDADE POR TIPO (não deixa outlier entrar).
create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;
  insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref)
  select cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref
  from (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf, nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      nullif(a->>'lat','')::double precision lat, nullif(a->>'lng','')::double precision lng,
      lower(a->>'tipo') tipo, lower(a->>'natureza') natureza,
      (a->>'valor_m2')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'nivel','')::smallint nivel, nullif(a->>'data_anuncio','')::date data_anuncio,
      coalesce(a->>'origem','pesquisa_web') origem, nullif(a->>'fonte_ref','') fonte_ref
    from jsonb_array_elements(p_amostras) a
    where (a->>'valor_m2') ~ '^[0-9.]+$'
      and a->>'natureza' in ('venda','locacao') and coalesce(a->>'cidade_norm','') <> ''
      and public.indice_plausivel(lower(a->>'tipo'), lower(a->>'natureza'), (a->>'valor_m2')::numeric)
    order by lower(a->>'natureza'), nullif(a->>'fonte_ref',''), (a->>'data_anuncio') desc nulls last
  ) d
  on conflict (natureza, fonte_ref) where fonte_ref is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;

-- 3) Índice ponderado por região/nível: agora IGNORA implausível por tipo, APARA extremos [p10..p90]
--    antes da média ponderada (headline robusto ao mix de padrão) e DEVOLVE as bandas de padrão.
create or replace function public.indice_regiao_ponderado(
  p_cidade_norm text, p_uf text, p_bairro_norm text,
  p_lat double precision, p_lng double precision, p_tipo text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cid text := lower(coalesce(p_cidade_norm,'')); v_uf text := upper(coalesce(p_uf,''));
  v_bai text := nullif(lower(coalesce(p_bairro_norm,'')),''); v_tipo text := lower(coalesce(p_tipo,''));
  v_min int := 5;
  v_res jsonb := '{}'::jsonb;
begin
  with base as (
    select natureza, valor_m2,
      1.0 / (1.0 + greatest(0, (current_date - coalesce(data_anuncio, current_date - 365)))::numeric / 365.0) as peso,
      case
        when p_lat is not null and p_lng is not null and lat is not null and lng is not null
          then 111320.0 * sqrt( power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2) )
        else null end as dist_m,
      (v_bai is not null and bairro_norm = v_bai) as mesmo_bairro
    from public.indice_amostras
    where cidade_norm = v_cid and uf = v_uf and tipo = v_tipo
      and public.indice_plausivel(v_tipo, natureza, valor_m2)   -- descarta outlier impossível p/ o tipo
  ),
  niveis as (
    select natureza, valor_m2, peso,
      case
        when (dist_m is not null and dist_m <= 250) or mesmo_bairro then 1
        when (dist_m is not null and dist_m <= 1000) then 2
        else 3 end as nivel
    from base
  ),
  cont as (
    select natureza, nivel, count(*) n from niveis group by natureza, nivel
  ),
  escolha as (
    select distinct on (natureza) natureza, nivel
    from (
      select c.*, sum(n) over (partition by c.natureza order by nivel) as acum
      from cont c
    ) t
    where acum >= v_min or nivel = 3
    order by natureza, nivel
  ),
  -- percentis (sem peso) sobre TODAS as amostras até o nível escolhido: bandas de PADRÃO + corte de cauda
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
  -- média PONDERADA aparada (só o miolo [p10..p90]) → headline robusto ao Alphaville x popular
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
    'venda_pop',   (select round(p25::numeric) from agreg where natureza='venda'),   -- padrão popular
    'venda_med',   (select round(p50::numeric) from agreg where natureza='venda'),   -- padrão médio
    'venda_alto',  (select round(p75::numeric) from agreg where natureza='venda'),   -- padrão alto
    'locacao_med', (select round(p50::numeric, 2) from agreg where natureza='locacao'),
    'n_venda',     coalesce((select n from agreg where natureza='venda'), 0),
    'n_locacao',   coalesce((select n from agreg where natureza='locacao'), 0),
    'nivel',       coalesce((select nivel_escolhido from agreg where natureza='venda'),
                            (select nivel_escolhido from agreg where natureza='locacao')),
    'cidade_norm', v_cid, 'uf', v_uf, 'tipo', v_tipo
  ) into v_res;
  return v_res;
end; $function$;

-- 4) Índice por BAIRRO: ignora implausível + apara extremos + devolve bandas por bairro.
-- (assinatura de retorno mudou: novas colunas venda_pop/venda_alto → precisa DROP antes do CREATE)
drop function if exists public.indice_bairros_cidade(text,text,text);
create or replace function public.indice_bairros_cidade(p_cidade_norm text, p_uf text, p_tipo text)
returns table (bairro_norm text, venda_m2 numeric, locacao_m2 numeric, venda_pop numeric, venda_alto numeric, n_venda int, n_locacao int)
language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select bairro_norm, natureza, valor_m2,
      1.0 / (1.0 + greatest(0, (current_date - coalesce(data_anuncio, current_date - 365)))::numeric / 365.0) as peso
    from public.indice_amostras
    where cidade_norm = lower(coalesce(p_cidade_norm,''))
      and uf = upper(coalesce(p_uf,''))
      and tipo = lower(coalesce(p_tipo,''))
      and bairro_norm is not null and bairro_norm <> ''
      and public.indice_plausivel(lower(coalesce(p_tipo,'')), natureza, valor_m2)
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

revoke all on function public.indice_bairros_cidade(text,text,text) from public, anon, authenticated;
grant execute on function public.indice_bairros_cidade(text,text,text) to service_role;
revoke all on function public.indice_regiao_ponderado(text,text,text,double precision,double precision,text) from public, anon, authenticated;
grant execute on function public.indice_regiao_ponderado(text,text,text,double precision,double precision,text) to service_role;
