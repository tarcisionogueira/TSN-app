-- NÍVEL ESTADO — último degrau do cascata do índice (250m → 1km → cidade → ESTADO). Quando a
-- cidade não tem base própria, devolve um valor de referência AMPLO do estado (mediana aparada
-- por tipo + bandas de padrão), sobre indice_amostra (mesma base dos outros níveis). Usado como
-- fallback final no card (indice-consulta.js) e no relatório (gerar-analise lerIndiceBidPro),
-- sempre deixando EXPLÍCITO que o número é do estado. Aplicada via MCP em produção.
create or replace function public.indice_estado_ponderado(p_uf text, p_tipo text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_res jsonb;
begin
  with base as (
    select valor_m2,
      1.0/(1.0+greatest(0,(current_date-coalesce(data_ref, current_date-365)))::numeric/365.0) as peso
    from public.indice_amostra
    where uf = upper(coalesce(p_uf,'')) and tipo = lower(coalesce(p_tipo,'')) and especie='venda'
      and public.indice_plausivel(lower(coalesce(p_tipo,'')),'venda',valor_m2)
  ),
  pctl as (
    select percentile_cont(0.10) within group (order by valor_m2) p10,
           percentile_cont(0.25) within group (order by valor_m2) p25,
           percentile_cont(0.50) within group (order by valor_m2) p50,
           percentile_cont(0.75) within group (order by valor_m2) p75,
           percentile_cont(0.90) within group (order by valor_m2) p90,
           count(*) n from base
  ),
  agg as (
    select sum(b.valor_m2*b.peso) filter (where b.valor_m2 between p.p10 and p.p90) svp,
           sum(b.peso)            filter (where b.valor_m2 between p.p10 and p.p90) sp,
           p.p25, p.p50, p.p75, p.n
    from base b cross join pctl p
    group by p.p10, p.p90, p.p25, p.p50, p.p75, p.n
  )
  select jsonb_build_object(
    'venda_m2',   round(svp/nullif(sp,0), 2),
    'venda_pop',  round(p25::numeric), 'venda_med', round(p50::numeric), 'venda_alto', round(p75::numeric),
    'n_venda',    n, 'nivel', 'estado', 'uf', upper(coalesce(p_uf,'')), 'tipo', lower(coalesce(p_tipo,''))
  ) into v_res from agg;
  return coalesce(v_res, jsonb_build_object('venda_m2', null, 'n_venda', 0, 'nivel', 'estado'));
end; $function$;

revoke all on function public.indice_estado_ponderado(text,text) from public, anon, authenticated;
grant execute on function public.indice_estado_ponderado(text,text) to service_role;
