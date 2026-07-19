-- Índice PRÓPRIO de mercado por MICRORREGIÃO (tira a dependência de fonte externa).
-- Segmentado em 3 níveis (o mais específico vence no consumo do score/filtro):
--   'bairro' (cidade+bairro, ~84% cobertura) · 'grid' (célula geográfica ~1km, cobre os
--   sem bairro) · 'cidade' (piso). O vetor de POI ajusta por imóvel, POR CIMA do nível.
-- v1: venda R$/m² = mediana de (valor_avaliacao / area_m2) do acervo residencial.
-- aluguel_m2 fica p/ ser semeado/aprendido pelos relatórios (loop de validação por
-- microrregião — NÃO depende de cron: compõe à medida que os relatórios são gerados).
-- fator_calibracao: a avaliação de leilão roda abaixo do mercado; o fator (aprendido dos
-- relatórios/FipeZAP) converte o bruto em estimativa de mercado. Default 1.0 até calibrar.
drop function if exists public.recalcular_cidade_indicadores();
drop table if exists public.cidade_indicadores cascade;
create table public.cidade_indicadores (
  nivel            text not null,              -- 'bairro' | 'grid' | 'cidade'
  cidade_norm      text not null,
  uf               text not null,
  bairro_norm      text not null default '',
  geo_grid         text not null default '',   -- 'lat.dd,lng.dd' (~1km) quando nivel='grid'
  tipo             text not null default 'residencial',
  venda_m2         numeric,                     -- mediana avaliacao/m2 (bruto do acervo)
  venda_m2_mercado numeric,                     -- venda_m2 * fator_calibracao (estimativa de mercado)
  aluguel_m2       numeric,                     -- semeado/aprendido pelos relatorios
  n_amostras       integer default 0,
  fonte            text default 'acervo',
  fator_calibracao numeric default 1.0,
  atualizado_em    timestamptz default now(),
  primary key (nivel, cidade_norm, uf, bairro_norm, geo_grid, tipo)
);

-- Dado de referência de mercado, sem PII: leitura liberada (o Busca vai exibir), escrita só service_role.
alter table public.cidade_indicadores enable row level security;
create policy cidade_indicadores_read on public.cidade_indicadores for select using (true);
grant select on public.cidade_indicadores to anon, authenticated;

-- Recalcula os 3 níveis a partir do acervo (bootstrap/piso; o valor autoritativo vem dos relatórios).
create function public.recalcular_cidade_indicadores()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare c integer; b integer; g integer;
begin
  create temp table _bi on commit drop as
  select cidade_norm,
         upper(estado) as uf,
         trim(regexp_replace(
           lower(translate(coalesce(bairro,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')),
           '[^a-z0-9]+', ' ', 'g')) as bairro_norm,
         case when latitude is not null and latitude <> 0 and longitude is not null and longitude <> 0
              then round(latitude::numeric, 2)::text || ',' || round(longitude::numeric, 2)::text
              else null end as geo_grid,
         valor_avaliacao / nullif(area_m2, 0) as rm2
  from public.imoveis_leilao
  where ativo and valor_avaliacao > 0 and area_m2 between 20 and 500
    and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
    and (tipo ilike '%apart%' or tipo ilike '%casa%' or tipo ilike '%sobrado%'
         or tipo ilike '%kitnet%' or tipo ilike '%imov%' or tipo is null);

  delete from public.cidade_indicadores where fonte = 'acervo';

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'cidade', cidade_norm, uf, '', '', 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         count(*), 'acervo', now()
  from _bi group by cidade_norm, uf having count(*) >= 5;
  get diagnostics c = row_count;

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'bairro', cidade_norm, uf, bairro_norm, '', 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         count(*), 'acervo', now()
  from _bi where bairro_norm <> '' group by cidade_norm, uf, bairro_norm having count(*) >= 5;
  get diagnostics b = row_count;

  insert into public.cidade_indicadores(nivel,cidade_norm,uf,bairro_norm,geo_grid,tipo,venda_m2,venda_m2_mercado,n_amostras,fonte,atualizado_em)
  select 'grid', cidade_norm, uf, '', geo_grid, 'residencial',
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         round(percentile_cont(0.5) within group (order by rm2)::numeric,0),
         count(*), 'acervo', now()
  from _bi where geo_grid is not null group by cidade_norm, uf, geo_grid having count(*) >= 5;
  get diagnostics g = row_count;

  return jsonb_build_object('cidade', c, 'bairro', b, 'grid', g);
end;
$fn$;

-- Não expor a função definer a anon/authenticated (mantém auditoria_seguranca limpa) — revogar
-- de anon/authenticated também, não só de public (o Supabase concede execute por padrão a eles).
revoke execute on function public.recalcular_cidade_indicadores() from public, anon, authenticated;
grant execute on function public.recalcular_cidade_indicadores() to service_role;
