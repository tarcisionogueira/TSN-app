-- 29/09 — URBANO × RURAL PELA LOCALIZAÇÃO (pedido do dono).
--
-- O que decide se um imóvel é urbano é o PERÍMETRO URBANO do município, não o que a matrícula
-- escreveu décadas atrás — e é isso que define o mercado comparável. A fonte nacional mais próxima
-- da lei municipal é a malha de SETORES CENSITÁRIOS do IBGE (Censo 2022), onde cada setor tem
-- situação urbana/rural. O carregador (scripts/carregar-area-urbana-ibge.py, no runner — a nuvem do
-- Claude não alcança o IBGE) junta os setores urbanos de cada município num polígono só.
--
-- REGRA DE HONESTIDADE (formas #5/#10): 57% dos terrenos/rurais ativos têm o pino só no CENTRO DA
-- CIDADE — que é sempre urbano. Classificar esses daria "urbana" com cara de resposta. Por isso:
-- só classifica com pino de endereço/rua/bairro, exige MARGEM da divisa proporcional à precisão
-- do pino, e UF não carregada responde 'indeterminada' em vez de 'rural'.
create extension if not exists postgis with schema extensions;

create table if not exists public.area_urbana_municipio (
  cd_mun text primary key,
  nome text,
  uf text not null,
  geom extensions.geometry(MultiPolygon, 4326),   -- null = município sem setor urbano na malha
  n_setores_urbanos int,
  fonte text not null default 'IBGE — setores censitários Censo 2022',
  carregado_em timestamptz not null default now()
);
create index if not exists area_urbana_municipio_geom on public.area_urbana_municipio using gist (geom);
create index if not exists area_urbana_municipio_uf on public.area_urbana_municipio (uf);
alter table public.area_urbana_municipio enable row level security;

-- Carga por UF: sem linha aqui, a UF não foi carregada e nada nela é "rural".
create table if not exists public.area_urbana_carga (
  uf text primary key,
  municipios int not null,
  setores int not null,
  setores_urbanos int not null,
  arquivo text,
  carregado_em timestamptz not null default now()
);
alter table public.area_urbana_carga enable row level security;

alter table public.imoveis_leilao add column if not exists situacao_geo text
  check (situacao_geo in ('urbana', 'rural', 'indeterminada'));
alter table public.imoveis_leilao add column if not exists situacao_geo_em timestamptz;

-- Recebe um lote de municípios: [{cd_mun, nome, uf, n, geojson}] (geojson null = sem área urbana).
create or replace function public.carregar_area_urbana(p jsonb) returns int
language plpgsql set search_path = public, extensions as $f$
declare e jsonb; n int := 0;
begin
  for e in select * from jsonb_array_elements(p) loop
    insert into area_urbana_municipio (cd_mun, nome, uf, geom, n_setores_urbanos, carregado_em)
    values (e->>'cd_mun', e->>'nome', e->>'uf',
            case when e->>'geojson' is null then null
                 else ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(e->>'geojson'), 4326)), 3)) end,
            (e->>'n')::int, now())
    on conflict (cd_mun) do update set nome = excluded.nome, uf = excluded.uf, geom = excluded.geom,
      n_setores_urbanos = excluded.n_setores_urbanos, carregado_em = now();
    n := n + 1;
  end loop;
  return n;
end $f$;

create or replace function public.registrar_carga_area_urbana(p_uf text, p_municipios int, p_setores int, p_urbanos int, p_arquivo text)
returns void language sql set search_path = public as $f$
  insert into area_urbana_carga (uf, municipios, setores, setores_urbanos, arquivo, carregado_em)
  values (p_uf, p_municipios, p_setores, p_urbanos, p_arquivo, now())
  on conflict (uf) do update set municipios = excluded.municipios, setores = excluded.setores,
    setores_urbanos = excluded.setores_urbanos, arquivo = excluded.arquivo, carregado_em = now();
$f$;

-- Situação do PONTO. Margem da divisa por precisão do pino: um pino de rua pode estar a centenas
-- de metros do lote; a 50 m da divisa ele não prova nada.
create or replace function public.situacao_geo(p_lat numeric, p_lng numeric, p_nivel text, p_uf text)
returns text language plpgsql stable set search_path = public, extensions as $f$
declare pt geometry; margem numeric; g geometry; dist numeric;
begin
  if p_lat is null or p_lng is null or p_nivel is null then return 'indeterminada'; end if;
  margem := case p_nivel when 'endereco' then 150 when 'rua' then 300 when 'bairro' then 800 else null end;
  if margem is null then return 'indeterminada'; end if;          -- cidade/falhou/refazer
  if p_uf is null or not exists (select 1 from area_urbana_carga where uf = upper(p_uf)) then return 'indeterminada'; end if;
  pt := ST_SetSRID(ST_MakePoint(p_lng::float8, p_lat::float8), 4326);
  select geom into g from area_urbana_municipio where geom && pt and ST_Intersects(geom, pt) limit 1;
  if g is not null then
    dist := ST_Distance(ST_Boundary(g)::geography, pt::geography);
    return case when dist >= margem then 'urbana' else 'indeterminada' end;
  end if;
  -- Fora de toda área urbana: só é rural se nenhuma estiver dentro da margem.
  if exists (select 1 from area_urbana_municipio
              where geom && ST_Expand(pt, margem / 80000.0)
                and ST_DWithin(geom::geography, pt::geography, margem)) then
    return 'indeterminada';
  end if;
  return 'rural';
end $f$;

create or replace function public.trg_situacao_geo() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.situacao_geo := public.situacao_geo(new.latitude, new.longitude, new.geocod_nivel, new.estado);
  new.situacao_geo_em := now();
  return new;
end $f$;

-- 'trg_zzz_' roda DEPOIS de trg_zz_geocode_pino_generico (que pode anular o pino genérico).
drop trigger if exists trg_zzz_situacao_geo on public.imoveis_leilao;
create trigger trg_zzz_situacao_geo before insert or update of latitude, longitude, geocod_nivel, estado
  on public.imoveis_leilao for each row execute function public.trg_situacao_geo();

-- Reclassifica em fatias (o carregador chama até voltar 0): só ativos, e só quem foi classificado
-- ANTES da carga desta UF (recarregar uma UF reclassifica tudo dela de novo).
create or replace function public.reclassificar_situacao_geo(p_uf text, p_limite int default 500)
returns int language plpgsql set search_path = public as $f$
declare n int;
begin
  with alvo as (
    select id, public.situacao_geo(latitude, longitude, geocod_nivel, estado) s
      from imoveis_leilao
     where ativo and upper(estado) = upper(p_uf)
       and (situacao_geo_em is null
            or situacao_geo_em < (select carregado_em from area_urbana_carga where uf = upper(p_uf)))
     limit p_limite)
  update imoveis_leilao i set situacao_geo = alvo.s, situacao_geo_em = now() from alvo where i.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $f$;

revoke all on function public.carregar_area_urbana(jsonb) from public, anon, authenticated;
revoke all on function public.registrar_carga_area_urbana(text, int, int, int, text) from public, anon, authenticated;
revoke all on function public.reclassificar_situacao_geo(text, int) from public, anon, authenticated;
grant execute on function public.carregar_area_urbana(jsonb) to service_role;
grant execute on function public.registrar_carga_area_urbana(text, int, int, int, text) to service_role;
grant execute on function public.reclassificar_situacao_geo(text, int) to service_role;
