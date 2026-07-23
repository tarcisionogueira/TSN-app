-- PASSO 3 (fundação) — ÍNDICE PERMANENTE com amostras append-only e peso por idade.
--
-- O "Gerar índice" passa a fazer pesquisa mercadológica e GUARDAR cada amostra de R$/m²
-- (venda e locação) numa base que NUNCA se apaga. Quanto mais relatórios/índices rodam numa
-- região, mais amostras → índice mais maduro. O valor final é PONDERADO pela idade do anúncio
-- (recente pesa mais), com rastreabilidade (origem + fonte_ref). Alimenta o mercadológico
-- (cache-first, nos próximos passos) → derruba o custo conforme a base amadurece.

-- 1) Amostras de mercado (append-only; sem update/delete no fluxo normal).
create table if not exists public.indice_amostras (
  id bigint generated always as identity primary key,
  cidade_norm text not null,
  uf text not null,
  bairro_norm text,
  lat double precision,
  lng double precision,
  tipo text not null,                                   -- apartamento/casa/terreno/comercial
  natureza text not null check (natureza in ('venda','locacao')),
  valor_m2 numeric not null check (valor_m2 > 0),
  area_m2 numeric,
  nivel smallint,                                       -- 1 (≤250m/mesma rua) | 2 (≤1km) da busca que gerou
  data_anuncio date,                                    -- data do anúncio (peso por idade)
  origem text,                                          -- 'pesquisa_web' | 'acervo' | 'relatorio_mercado'
  fonte_ref text,                                       -- rastreabilidade: url/id do anúncio ou imóvel
  criado_em timestamptz not null default now()
);
create index if not exists indice_amostras_regiao_idx on public.indice_amostras (cidade_norm, uf, tipo, natureza, bairro_norm);
create index if not exists indice_amostras_geo_idx    on public.indice_amostras (lat, lng);
-- dedup real por anúncio (dentro do batch e entre batches)
create unique index if not exists indice_amostras_fonte_uq
  on public.indice_amostras (natureza, fonte_ref) where fonte_ref is not null;

-- Base de mercado é ativo estratégico: nada de leitura crua pelo cliente (só o agregado via
-- RPC SECURITY DEFINER). Admin lê para auditar. Escrita só via RPC.
alter table public.indice_amostras enable row level security;
drop policy if exists indice_amostras_admin on public.indice_amostras;
create policy indice_amostras_admin on public.indice_amostras for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));

-- 2) Ingestão de amostras (usada pelo endpoint do índice e pelo mercadológico). Deduplica por
--    (natureza, fonte_ref) dentro do batch (distinct on) e entre batches (índice único +
--    on conflict). Faixas por natureza: venda R$/m² 200–200000; locação R$/m²/mês 1–500.
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
      and ( (lower(a->>'natureza')='venda'   and (a->>'valor_m2')::numeric between 200 and 200000)
         or (lower(a->>'natureza')='locacao' and (a->>'valor_m2')::numeric between 1 and 500) )
    order by lower(a->>'natureza'), nullif(a->>'fonte_ref',''), (a->>'data_anuncio') desc nulls last
  ) d
  on conflict (natureza, fonte_ref) where fonte_ref is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;

-- 3) Índice PONDERADO por região/nível. Peso por idade do anúncio (recente pesa mais; nada
--    é descartado). Cai de nível quando falta amostra: bairro/raio ≤250m → ≤1km → cidade.
--    Distância aproximada (equiretangular, ok p/ ≤1km). Retorna venda/locação R$/m² + amostras.
create or replace function public.indice_regiao_ponderado(
  p_cidade_norm text, p_uf text, p_bairro_norm text,
  p_lat double precision, p_lng double precision, p_tipo text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cid text := lower(coalesce(p_cidade_norm,'')); v_uf text := upper(coalesce(p_uf,''));
  v_bai text := nullif(lower(coalesce(p_bairro_norm,'')),''); v_tipo text := lower(coalesce(p_tipo,''));
  v_min int := 5;  -- amostras mínimas p/ aceitar um nível
  -- peso por idade: hoje≈1, 1 ano≈0,5, 2 anos≈0,33; null→0,5. Nunca zero (não perde amostra).
  v_res jsonb := '{}'::jsonb;
begin
  -- distância aprox + peso por idade; escolhe o nível mais específico com amostra suficiente.
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
  ),
  niveis as (
    select natureza, valor_m2, peso,
      case
        when (dist_m is not null and dist_m <= 250) or mesmo_bairro then 1
        when (dist_m is not null and dist_m <= 1000) then 2
        else 3 end as nivel
    from base
  ),
  -- escolhe o nível mais específico com >= v_min amostras, por natureza
  cont as (
    select natureza, nivel, count(*) n, sum(peso) sp, sum(valor_m2*peso) svp
    from niveis group by natureza, nivel
  ),
  escolha as (
    select distinct on (natureza) natureza, nivel, n, sp, svp
    from (
      select c.*, sum(n) over (partition by c.natureza order by nivel) as acum
      from cont c
    ) t
    where acum >= v_min or nivel = 3
    order by natureza, nivel
  ),
  agreg as (
    -- agrega TODAS as amostras até o nível escolhido (inclusive), por natureza
    select e.natureza, e.nivel as nivel_escolhido,
      sum(n2.valor_m2 * n2.peso) filter (where n2.nivel <= e.nivel) as svp,
      sum(n2.peso)               filter (where n2.nivel <= e.nivel) as sp,
      count(*)                   filter (where n2.nivel <= e.nivel) as n
    from escolha e join niveis n2 on n2.natureza = e.natureza
    group by e.natureza, e.nivel
  )
  select jsonb_build_object(
    'venda_m2',   (select round(svp/nullif(sp,0), 2) from agreg where natureza='venda'),
    'locacao_m2', (select round(svp/nullif(sp,0), 2) from agreg where natureza='locacao'),
    'n_venda',    coalesce((select n from agreg where natureza='venda'), 0),
    'n_locacao',  coalesce((select n from agreg where natureza='locacao'), 0),
    'nivel',      coalesce((select nivel_escolhido from agreg where natureza='venda'),
                           (select nivel_escolhido from agreg where natureza='locacao')),
    'cidade_norm', v_cid, 'uf', v_uf, 'tipo', v_tipo
  ) into v_res;
  return v_res;
end; $function$;