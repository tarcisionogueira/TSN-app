-- ─────────────────────────────────────────────────────────────────────────────
-- 12/08 — Conserto da ingestão do Censo + as 3 leituras de cobertura do Índice.
-- Aplicada em produção em 12/08. (Corpo das funções: ver as migrações citadas.)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) FONTES DO IBGE. `censo_populacao` apontava para o agregado 4709 e pedia 4 colunas.
-- A sonda `?metadados=` provou que o 4709 tem TRÊS variáveis, e nenhuma é área ou densidade:
--   "População residente" · "Variação absoluta da população residente 2010 compatibilizada"
--   · "Taxa de crescimento geométrico"
-- Ou seja, `area_km2` e `densidade_hab_km2` eram IMPOSSÍVEIS ali, e `crescimento_pct` casava
-- contra "variação RELATIVA", string inexistente. A ingestão pedia o impossível, trazia 1 de 4
-- e gravava ok=true com 5.570 linhas — `cidade_socio.area_km2` ficou 8 dias vazia com o painel
-- de fontes verde.
-- Área e densidade moram no agregado 4714 ("População Residente, Área territorial e Densidade
-- demográfica", variáveis 93 / 6318 / 614).
update public.socio_fontes
   set mapa = '{"popula(ç|c)(ã|a)o residente$": "populacao",
                "taxa de crescimento geom": "crescimento_pct"}'::jsonb,
       descricao = 'Censo 2022 — população residente e taxa de crescimento geométrico (agregado 4709; área/densidade vêm do 4714)'
 where chave = 'censo_populacao';

insert into public.socio_fontes (chave, descricao, agregado, periodo, mapa, ativa, ordem)
values (
  'censo_area_densidade',
  'Censo 2022 — área da unidade territorial (km²) e densidade demográfica (hab/km²)',
  '4714', '2022',
  '{"(á|a)rea da unidade territorial": "area_km2",
    "densidade demogr": "densidade_hab_km2"}'::jsonb,
  true, 15)
on conflict (chave) do update set
  descricao = excluded.descricao, agregado = excluded.agregado,
  periodo = excluded.periodo, mapa = excluded.mapa, ativa = true;

-- 2) COBERTURA DO ÍNDICE EM 3 LEITURAS QUE SE COBREM.
-- Nenhuma sozinha responde "quanto está mapeado":
--   ACERVO     — dos imóveis que anunciamos, quantos caem num recorte indexado (RELEVÂNCIA).
--   TERRITÓRIO — área dos grids (0,01° ≈ 1,21 km²) ÷ área do município (EXTENSÃO). Sozinha
--                engana: o denominador inclui zona rural. Cuiabá tem 4.327 km² e dá 0,03%.
--   POPULAÇÃO  — % da população do país em cidades com índice (ALCANCE), no card "Brasil mapeado".
-- É o CRUZAMENTO que informa: Lauro de Freitas 6,3% de território com 57,3% de acervo =
-- concentrada onde importa; Cuiabá 0,03% e 1,6% = mal coberta.
-- FALTA a leitura mais assertiva para território — área URBANIZADA no lugar da área do
-- município. Depende de ingerir esse recorte do IBGE. Até lá o card diz "da área dos
-- municípios", não "do território": a diferença é de ordem de grandeza.
create or replace function public.indice_cobertura_resumo()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  -- Bairro normalizado NOS DOIS LADOS (corrigido em 12/08, no mesmo dia): a primeira versão
  -- tirava os não-alfanuméricos só do lado do IMÓVEL e comparava com o `bairro_norm` intacto,
  -- que guarda espaços ("vila santa terezinha"). Só casavam bairros de UMA palavra: 6 de 23.
  -- Normalizando os dois, 17 de 23. Terceira vez no dia que convenções diferentes entre
  -- tabelas feitas para casar mordem — e sempre errando para BAIXO, que ninguém questiona.
  with rec as (
    select distinct cidade_norm, uf,
           nullif(lower(regexp_replace(translate(coalesce(bairro_norm,''),
             'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucAAAAEEIOOOUUC'),'[^a-zA-Z0-9]','','g')),'') bairro,
           nullif(geo_grid,'') grid
      from public.cidade_indicadores where nivel in ('bairro','grid')),
  im as (
    select i.cidade_norm, upper(i.estado) uf,
           lower(regexp_replace(translate(coalesce(i.bairro,''),
             'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucAAAAEEIOOOUUC'),'[^a-zA-Z0-9]','','g')) bairro_n,
           to_char(round(i.latitude::numeric,2),'FM999990.00')||','||
           to_char(round(i.longitude::numeric,2),'FM999990.00') grid
      from public.imoveis_leilao i
     where i.ativo and i.latitude is not null and coalesce(i.cidade_norm,'') <> ''),
  cidades_idx as (select distinct cidade_norm, uf from rec),
  acervo as (
    select count(*) imoveis,
           count(*) filter (where exists (select 1 from rec r
             where r.cidade_norm=im.cidade_norm and r.uf=im.uf
               and (r.grid=im.grid or (r.bairro is not null and r.bairro=im.bairro_n)))) cobertos
      from im
     where exists (select 1 from cidades_idx c where c.cidade_norm=im.cidade_norm and c.uf=im.uf)),
  terr as (
    select coalesce(sum(g.grids) * 1.21, 0) km2_mapeado, coalesce(sum(cs.area_km2), 0) km2_total
      from (select cidade_norm, uf, count(distinct geo_grid) grids
              from public.cidade_indicadores
             where nivel='grid' and coalesce(geo_grid,'') <> '' group by 1,2) g
      left join public.cidade_socio cs on cs.nivel='cidade' and cs.uf = g.uf
        and replace(replace(cs.cidade_norm,' ',''),'-','') = replace(replace(g.cidade_norm,' ',''),'-',''))
  select jsonb_build_object(
    'cidades_com_indice', (select count(*) from cidades_idx),
    'acervo_total',       (select imoveis from acervo),
    'acervo_coberto',     (select cobertos from acervo),
    'pct_acervo',         (select round(100.0*cobertos/nullif(imoveis,0),1) from acervo),
    'km2_mapeado',        (select round(km2_mapeado,1) from terr),
    'km2_municipios',     (select round(km2_total,0) from terr),
    'pct_municipio',      (select round(100.0*km2_mapeado/nullif(km2_total,0),2) from terr));
$$;

revoke all on function public.indice_cobertura_resumo() from public, anon;
grant execute on function public.indice_cobertura_resumo() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADENDO (12/08, mesmo dia): entrou a terceira leitura, e era a mais assertiva.
-- ÁREA URBANIZADA por município — IBGE agregado 8418 ("Áreas Urbanizadas do Brasil"),
-- variável 12749, achado pela busca no catálogo (`?buscar=urbaniz`).
--
-- Por que ela muda tudo:  São Paulo 1.521,2 km² de município · 914,6 de mancha urbana
--                         Cuiabá    4.327,4 km² de município · 160,6 de mancha urbana (27×)
-- Medir contra o município faz um índice bom parecer 0,03%, porque o denominador inclui zona
-- rural que ninguém precisa mapear. Agregado do sistema: 2,3% da mancha urbana contra 0,38%
-- da área municipal — seis vezes de diferença, e a de 2,3% é a honesta.
--
-- CUIDADO NO REGEX: o agregado traz subcategorias ("Áreas urbanizadas pouco densas",
-- "Loteamentos vazios", "Vazios intraurbanos", "Área total mapeada"). O padrão é ANCORADO
-- (^…$) — um regex frouxo gravaria a subcategoria errada na coluna sem avisar.
--
-- E A COLUNA NOVA ENTRA NO socio_upsert JUNTO: aquela função enumera as colunas uma a uma, e
-- `jsonb_populate_recordset` descarta em silêncio o que não estiver lá. Foi assim que
-- `area_km2` ficou 8 dias vazia. Coluna nova e upsert mudam na MESMA migração, nunca depois.
alter table public.cidade_socio add column if not exists area_urbanizada_km2 numeric;

insert into public.socio_fontes (chave, descricao, agregado, periodo, mapa, ativa, ordem)
values ('ibge_area_urbanizada',
        'Áreas Urbanizadas do Brasil — mancha urbana por município (km²)',
        '8418', '-1',
        '{"^(á|a)reas urbanizadas$": "area_urbanizada_km2"}'::jsonb, true, 16)
on conflict (chave) do update set
  descricao = excluded.descricao, agregado = excluded.agregado,
  periodo = excluded.periodo, mapa = excluded.mapa, ativa = true;

-- (socio_upsert e indice_cobertura_resumo foram reescritas com a coluna nova — ver o estado
--  vigente no banco; ambas estão em migrações aplicadas em 12/08.)
