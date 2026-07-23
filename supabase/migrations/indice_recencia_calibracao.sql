-- ─────────────────────────────────────────────────────────────────────────────
-- ÍNDICE BIDPRO — fecha o loop de precisão (itens 3 e 4 do plano do dono)
--   3) RECÊNCIA: reconstrói o índice consolidado (nível cidade) a partir das amostras
--      DATADAS recentes, em vez de acumular seed velho. O read passa a preferir a linha
--      mais FRESCA.
--   4) CALIBRAÇÃO: compara a REVENDA real (gabarito) com o índice de venda da região e
--      ajusta o fator_calibracao (bounded + suavizado). Sem gabarito, não mexe em nada.
--      O read aplica o fator → o índice fica "cada vez mais certeiro" com o uso.
-- ─────────────────────────────────────────────────────────────────────────────

-- ITEM 3 — recência: mediana de R$/m² das amostras dos últimos p_meses vira o índice.
create or replace function public.indice_consolidar_amostras(p_meses integer default 18, p_min integer default 5)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare v_n integer := 0;
begin
  with recentes as (
    select cidade_norm, uf, tipo, especie, valor_m2
    from public.indice_amostra
    where data_ref >= (current_date - make_interval(months => greatest(1, p_meses)))
      and valor_m2 is not null and valor_m2 > 0
  ),
  vend as (
    select cidade_norm, uf, tipo,
      (percentile_cont(0.5) within group (order by valor_m2))::numeric as m2, count(*) as n
    from recentes where especie='venda' group by 1,2,3 having count(*) >= greatest(1, p_min)
  ),
  alug as (
    select cidade_norm, uf, tipo,
      (percentile_cont(0.5) within group (order by valor_m2))::numeric as m2, count(*) as n
    from recentes where especie='locacao' group by 1,2,3 having count(*) >= 3
  ),
  ins as (
    insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,
        venda_m2,venda_m2_mercado,aluguel_m2,n_amostras,fonte,fator_calibracao,atualizado_em)
    select 'cidade', v.cidade_norm, v.uf, '', '', v.tipo,
        round(v.m2,0), round(v.m2,0), round(a.m2,2), v.n, 'amostras', 1.0, now()
    from vend v left join alug a using (cidade_norm, uf, tipo)
    on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do update set
        venda_m2_mercado = excluded.venda_m2_mercado,
        venda_m2         = excluded.venda_m2,
        aluguel_m2       = coalesce(excluded.aluguel_m2, public.cidade_indicadores.aluguel_m2),
        n_amostras       = greatest(public.cidade_indicadores.n_amostras, excluded.n_amostras),
        fonte            = 'amostras',
        atualizado_em    = now()
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $function$;

-- ITEM 4 — calibração: fator_calibracao ← revenda real / índice de venda (bounded 0,7–1,3,
-- suavizado 50/50). Só age em região com >= p_min revendas recentes (gabarito).
create or replace function public.indice_calibrar(p_min integer default 5, p_meses integer default 24)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare v_n integer := 0;
begin
  with gab as (
    select cidade_norm, uf, tipo,
      (percentile_cont(0.5) within group (order by valor_m2))::numeric as real_m2, count(*) as n
    from public.indice_amostra
    where origem='revenda' and especie='venda' and valor_m2 is not null and valor_m2 > 0
      and data_ref >= (current_date - make_interval(months => greatest(1, p_meses)))
    group by 1,2,3 having count(*) >= greatest(2, p_min)
  ),
  upd as (
    update public.cidade_indicadores c set
      fator_calibracao = greatest(0.7, least(1.3,
        round((coalesce(c.fator_calibracao,1)*0.5 + (g.real_m2 / nullif(c.venda_m2_mercado,0))*0.5)::numeric, 3))),
      atualizado_em = now()
    from gab g
    where c.nivel='cidade' and c.cidade_norm=g.cidade_norm and c.uf=g.uf and c.tipo=g.tipo
      and c.venda_m2_mercado is not null and c.venda_m2_mercado > 0
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $function$;

-- READ: prefere a linha mais FRESCA (recência) e APLICA o fator de calibração ao venda_m2.
create or replace function public.indice_bidpro_regiao(p_cidade_norm text, p_uf text, p_bairro text, p_lat numeric, p_lng numeric, p_tipo text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_bairro_norm text;
  v_grid text;
  v_tipo text := coalesce(nullif(p_tipo,''),'residencial');
  r record;
begin
  if coalesce(p_cidade_norm,'')='' or coalesce(p_uf,'')='' then return null; end if;
  v_bairro_norm := public._bairro_norm(p_bairro);
  v_grid := case when p_lat is not null and p_lat<>0 and p_lng is not null and p_lng<>0
                 then round(p_lat,2)::text||','||round(p_lng,2)::text else null end;

  select * into r from public.cidade_indicadores
  where cidade_norm=p_cidade_norm and uf=upper(p_uf) and tipo=v_tipo
    and (
      (nivel='bairro' and v_bairro_norm<>'' and bairro_norm=v_bairro_norm)
      or (nivel='grid' and v_grid is not null and geo_grid=v_grid)
      or (nivel='cidade')
    )
  order by case nivel when 'bairro' then 1 when 'grid' then 2 else 3 end,
           atualizado_em desc
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'nivel', r.nivel, 'fonte', r.fonte,
    'venda_m2', round(coalesce(r.venda_m2_mercado,0) * coalesce(r.fator_calibracao,1), 0),
    'aluguel_m2', r.aluguel_m2,
    'n_amostras', r.n_amostras, 'atualizado_em', r.atualizado_em,
    'fator_calibracao', r.fator_calibracao,
    'bairro_norm', nullif(r.bairro_norm,''), 'uf', r.uf);
end $function$;

-- Supervisor de IA (meta-aprendizado): sugestões de ajuste que o DONO revisa (nunca
-- aplicadas sozinhas). Sem policies → só service_role.
create table if not exists public.aprendizado_sugestoes (
  id        uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  escopo    text,
  resumo    text,
  detalhe   jsonb,
  aplicado  boolean not null default false
);
alter table public.aprendizado_sugestoes enable row level security;

revoke execute on function public.indice_consolidar_amostras(integer,integer) from public, anon, authenticated;
revoke execute on function public.indice_calibrar(integer,integer)            from public, anon, authenticated;
grant  execute on function public.indice_consolidar_amostras(integer,integer) to service_role;
grant  execute on function public.indice_calibrar(integer,integer)            to service_role;
