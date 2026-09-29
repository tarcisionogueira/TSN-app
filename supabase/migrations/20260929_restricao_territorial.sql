-- 29/09 — RESTRIÇÃO TERRITORIAL PELA LOCALIZAÇÃO (passo 2 do plano urbano × rural).
--
-- Caso que motivou: Embu-Guaçu (leilaobrasil_449). Avaliação judicial ~R$ 27/m², anúncios da cidade
-- R$ 450/m². O município está na APRM GUARAPIRANGA (Lei estadual 12.233/2006): lote mínimo e taxa
-- de ocupação por subárea, que anúncio urbano comum não carrega. Urbano × rural não pega isso.
--
-- Camadas (carregador scripts/carregar-restricoes-territoriais.py, no runner):
--   · 'uc'        — Unidades de Conservação do CNUC/MMA (Brasil todo; grupo PI ou US);
--   · 'manancial' — APRM/APM do DataGEO (SP).
-- `restricoes_geo` = {nivel, itens:[{camada, nome, categoria, grupo, subarea}]}. NULL = pino
-- impreciso, não verificável. `itens: []` NÃO quer dizer "sem restrição" fora das camadas
-- carregadas — o relatório só AFIRMA o que o mapa mostrou, nunca a ausência.
create table if not exists public.restricao_territorial (
  id bigserial primary key,
  camada text not null check (camada in ('uc', 'manancial')),
  codigo text not null,
  nome text not null,
  categoria text,
  grupo text,
  subarea text,
  esfera text,
  uf text,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  carregado_em timestamptz not null default now(),
  unique (camada, codigo)
);
create index if not exists restricao_territorial_geom on public.restricao_territorial using gist (geom);
alter table public.restricao_territorial enable row level security;

alter table public.imoveis_leilao add column if not exists restricoes_geo jsonb;
alter table public.imoveis_leilao add column if not exists restricoes_geo_em timestamptz;

create or replace function public.carregar_restricao_territorial(p jsonb) returns int
language plpgsql set search_path = public, extensions as $f$
declare e jsonb; n int := 0;
begin
  for e in select * from jsonb_array_elements(p) loop
    insert into restricao_territorial (camada, codigo, nome, categoria, grupo, subarea, esfera, uf, geom, carregado_em)
    values (e->>'camada', e->>'codigo', e->>'nome', e->>'categoria', e->>'grupo', e->>'subarea', e->>'esfera', e->>'uf',
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(e->>'geojson'), 4326)), 3)), now())
    on conflict (camada, codigo) do update set nome = excluded.nome, categoria = excluded.categoria,
      grupo = excluded.grupo, subarea = excluded.subarea, esfera = excluded.esfera, uf = excluded.uf,
      geom = excluded.geom, carregado_em = now();
    n := n + 1;
  end loop;
  return n;
end $f$;

-- Mesma régua de precisão do situacao_geo: pino de cidade não prova nada.
create or replace function public.restricoes_geo(p_lat numeric, p_lng numeric, p_nivel text)
returns jsonb language plpgsql stable set search_path = public, extensions as $f$
declare pt geometry; itens jsonb;
begin
  if p_lat is null or p_lng is null or p_nivel not in ('endereco', 'rua', 'bairro') then return null; end if;
  if not exists (select 1 from restricao_territorial) then return null; end if;
  pt := ST_SetSRID(ST_MakePoint(p_lng::float8, p_lat::float8), 4326);
  select coalesce(jsonb_agg(jsonb_build_object('camada', camada, 'nome', nome, 'categoria', categoria,
                                               'grupo', grupo, 'subarea', subarea) order by camada desc, nome), '[]'::jsonb)
    into itens
    from restricao_territorial where geom && pt and ST_Intersects(geom, pt);
  return jsonb_build_object('nivel', p_nivel, 'itens', itens);
end $f$;

-- O trigger de localização passa a preencher as duas coisas.
create or replace function public.trg_situacao_geo() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.situacao_geo := public.situacao_geo(new.latitude, new.longitude, new.geocod_nivel, new.estado);
  new.situacao_geo_em := now();
  new.restricoes_geo := public.restricoes_geo(new.latitude, new.longitude, new.geocod_nivel);
  new.restricoes_geo_em := now();
  return new;
end $f$;

create or replace function public.reclassificar_restricoes_geo(p_limite int default 500)
returns int language plpgsql set search_path = public as $f$
declare n int; carga timestamptz := (select max(carregado_em) from restricao_territorial);
begin
  if carga is null then return 0; end if;
  with alvo as (
    select id, public.restricoes_geo(latitude, longitude, geocod_nivel) r
      from imoveis_leilao
     where ativo and geocod_nivel in ('endereco', 'rua', 'bairro')
       and (restricoes_geo_em is null or restricoes_geo_em < carga)
     limit p_limite)
  update imoveis_leilao i set restricoes_geo = alvo.r, restricoes_geo_em = now() from alvo where i.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $f$;

revoke all on function public.carregar_restricao_territorial(jsonb) from public, anon, authenticated;
revoke all on function public.reclassificar_restricoes_geo(int) from public, anon, authenticated;
grant execute on function public.carregar_restricao_territorial(jsonb) to service_role;
grant execute on function public.reclassificar_restricoes_geo(int) to service_role;
