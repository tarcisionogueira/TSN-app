-- GANCHO relatório→índice: o relatório mercadológico apura o índice pelo MESMO agente
-- (aprenderNaEmissao em api/gerar-analise.js). Grava o valor de mercado VALIDADO
-- (comparáveis) na microrregião do imóvel, fonte='relatorio' (autoritativo, não recebe
-- fator — já é mercado). Latest-wins v1 + n_amostras como contador de confiança. O recalc
-- (bootstrap do acervo) passa a NÃO sobrescrever linhas de relatório (on conflict do nothing).
create or replace function public.registrar_indice_relatorio(p_imovel_id text, p_venda_m2 numeric, p_aluguel_m2 numeric default null)
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_cidade text; v_uf text; v_bairro text; v_lat numeric; v_lng numeric; v_grid text;
begin
  if p_imovel_id is null or p_imovel_id = '' or not (p_venda_m2 > 0) then return; end if;
  select cidade_norm, upper(estado),
         trim(regexp_replace(lower(translate(coalesce(bairro,''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g')),
         latitude, longitude
    into v_cidade, v_uf, v_bairro, v_lat, v_lng
  from public.imoveis_leilao where id::text = p_imovel_id limit 1;
  if v_cidade is null or coalesce(v_uf,'') = '' then return; end if;
  v_grid := case when v_lat is not null and v_lat <> 0 and v_lng is not null and v_lng <> 0
                 then round(v_lat::numeric,2)::text || ',' || round(v_lng::numeric,2)::text else null end;

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,aluguel_m2,n_amostras,fonte,atualizado_em)
  values ('cidade', v_cidade, v_uf, '', '', 'residencial', p_venda_m2, p_venda_m2, p_aluguel_m2, 1, 'relatorio', now())
  on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do update set
    venda_m2 = excluded.venda_m2, venda_m2_mercado = excluded.venda_m2,
    aluguel_m2 = coalesce(excluded.aluguel_m2, public.cidade_indicadores.aluguel_m2),
    n_amostras = public.cidade_indicadores.n_amostras + 1, fonte = 'relatorio', atualizado_em = now();

  if v_bairro <> '' then
    insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,aluguel_m2,n_amostras,fonte,atualizado_em)
    values ('bairro', v_cidade, v_uf, v_bairro, '', 'residencial', p_venda_m2, p_venda_m2, p_aluguel_m2, 1, 'relatorio', now())
    on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do update set
      venda_m2 = excluded.venda_m2, venda_m2_mercado = excluded.venda_m2,
      aluguel_m2 = coalesce(excluded.aluguel_m2, public.cidade_indicadores.aluguel_m2),
      n_amostras = public.cidade_indicadores.n_amostras + 1, fonte = 'relatorio', atualizado_em = now();
  end if;

  if v_grid is not null then
    insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,aluguel_m2,n_amostras,fonte,atualizado_em)
    values ('grid', v_cidade, v_uf, '', v_grid, 'residencial', p_venda_m2, p_venda_m2, p_aluguel_m2, 1, 'relatorio', now())
    on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do update set
      venda_m2 = excluded.venda_m2, venda_m2_mercado = excluded.venda_m2,
      aluguel_m2 = coalesce(excluded.aluguel_m2, public.cidade_indicadores.aluguel_m2),
      n_amostras = public.cidade_indicadores.n_amostras + 1, fonte = 'relatorio', atualizado_em = now();
  end if;
end;
$fn$;
revoke execute on function public.registrar_indice_relatorio(text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.registrar_indice_relatorio(text, numeric, numeric) to service_role;

-- Recalc (bootstrap) protegido: nunca sobrescreve linha de relatório nem estoura PK
-- (on conflict do nothing nos 3 níveis). Ver cidade_indicadores_indice_proprio_venda.sql
-- para a definição base; aqui só reforçamos o do-nothing.
create or replace function public.recalcular_cidade_indicadores()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare c integer; b integer; g integer;
begin
  create temp table _bi on commit drop as
  select cidade_norm, upper(estado) as uf,
         trim(regexp_replace(lower(translate(coalesce(bairro,''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g')) as bairro_norm,
         case when latitude is not null and latitude <> 0 and longitude is not null and longitude <> 0
              then round(latitude::numeric,2)::text || ',' || round(longitude::numeric,2)::text else null end as geo_grid,
         valor_avaliacao / nullif(area_m2, 0) as rm2
  from public.imoveis_leilao
  where ativo and valor_avaliacao > 0 and area_m2 between 20 and 500
    and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
    and (tipo ilike '%apart%' or tipo ilike '%casa%' or tipo ilike '%sobrado%' or tipo ilike '%kitnet%' or tipo ilike '%imov%' or tipo is null);

  delete from public.cidade_indicadores where fonte = 'acervo';

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'cidade', cidade_norm, uf, '', '', 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0), count(*), 'acervo', now()
  from _bi group by cidade_norm, uf having count(*) >= 5
  on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do nothing;
  get diagnostics c = row_count;

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'bairro', cidade_norm, uf, bairro_norm, '', 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0), count(*), 'acervo', now()
  from _bi where bairro_norm <> '' group by cidade_norm, uf, bairro_norm having count(*) >= 5
  on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do nothing;
  get diagnostics b = row_count;

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'grid', cidade_norm, uf, '', geo_grid, 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0), count(*), 'acervo', now()
  from _bi where geo_grid is not null group by cidade_norm, uf, geo_grid having count(*) >= 5
  on conflict (nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo) do nothing;
  get diagnostics g = row_count;

  return jsonb_build_object('cidade', c, 'bairro', b, 'grid', g);
end;
$fn$;
revoke execute on function public.recalcular_cidade_indicadores() from public, anon, authenticated;
grant execute on function public.recalcular_cidade_indicadores() to service_role;
