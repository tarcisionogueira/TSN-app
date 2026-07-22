-- ─────────────────────────────────────────────────────────────────────────────
-- ÍNDICE BIDPRO — amostras DATADAS + valorização por ano
-- O Índice consolidado (cidade_indicadores) guarda só o preço/m² atual (blend 50/50).
-- Para (a) valorização por ano/gráfico, (b) recência de verdade e (c) revenda como
-- amostra real, precisamos das amostras ATÔMICAS com data. Esta tabela é essa base.
--
-- REGRA DO DONO: arremate NÃO entra (operação extraordinária). Só amostras convencionais
-- de mercado: anúncios (venda/locação) dos relatórios, imobiliárias locais e REVENDAS
-- confirmadas de arrematados. Cada amostra carrega a data → filtro de recência evita
-- poluir o índice com dado velho. Poison-resistente (nada derivado de input do cliente).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.indice_amostra (
  id           uuid primary key default gen_random_uuid(),
  cidade_norm  text not null,
  uf           text not null,
  bairro_norm  text not null default '',
  geo_grid     text not null default '',
  tipo         text not null default 'residencial',
  especie      text not null check (especie in ('venda','locacao')),
  valor_m2     numeric,          -- venda: R$/m²; locação: R$/m²/mês (só quando há metragem)
  valor_total  numeric,          -- venda: preço anunciado; locação: aluguel mensal
  area_m2      numeric,
  data_ref     date not null,    -- 1º dia do mês do anúncio/transação (AAAA-MM-01)
  fonte        text,
  origem       text not null default 'relatorio'  -- 'relatorio' | 'revenda' | 'portal' | 'imobiliaria'
                 check (origem in ('relatorio','revenda','portal','imobiliaria')),
  imovel_id    text,
  analise_id   uuid,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_indice_amostra_regiao
  on public.indice_amostra (cidade_norm, uf, tipo, especie, data_ref);
create index if not exists idx_indice_amostra_bairro
  on public.indice_amostra (cidade_norm, uf, bairro_norm) where bairro_norm <> '';
-- Dedup best-effort: mesma fonte+preço+mês+região não repete (relatórios reaproveitados).
create unique index if not exists uq_indice_amostra_deduce
  on public.indice_amostra (cidade_norm, uf, especie, coalesce(valor_m2,-1), coalesce(valor_total,-1), data_ref, coalesce(fonte,''));
alter table public.indice_amostra enable row level security;  -- só service_role escreve/lê cru
comment on table public.indice_amostra is
  'Amostras de mercado datadas (Índice BidPro). Arremate NUNCA entra; só anúncios/revendas. Base da valorização por ano e da recência.';

-- Valorização por ano (mediana de R$/m² por ano) + variação do período. Agrega no nível
-- pedido (bairro se informado e com dados; senão cidade). Só VENDA por padrão (locação
-- raramente traz metragem por amostra). Retorna null se não há ≥2 anos com ≥3 amostras.
create or replace function public.indice_valorizacao_anual(
  p_cidade_norm text, p_uf text, p_tipo text default 'residencial',
  p_bairro_norm text default '', p_especie text default 'venda', p_anos integer default 6)
 returns jsonb
 language sql stable security definer set search_path to '' set statement_timeout to '15s'
as $function$
  with base as (
    select extract(year from data_ref)::int as ano, valor_m2
    from public.indice_amostra
    where cidade_norm = p_cidade_norm and uf = upper(p_uf)
      and tipo = coalesce(nullif(p_tipo,''),'residencial')
      and especie = coalesce(nullif(p_especie,''),'venda')
      and valor_m2 is not null and valor_m2 > 0
      and data_ref >= (current_date - make_interval(years => greatest(1, coalesce(p_anos,6))))
      and (coalesce(p_bairro_norm,'') = '' or bairro_norm = p_bairro_norm)
  ),
  por_ano as (
    select ano, (percentile_cont(0.5) within group (order by valor_m2))::numeric as m2, count(*) as n
    from base group by ano having count(*) >= 3
  ),
  ag as (
    select jsonb_agg(jsonb_build_object('ano',ano,'m2',round(m2,0),'n',n) order by ano) as serie,
           count(*) as anos,
           (array_agg(m2 order by ano))[1]      as m2_ini,
           (array_agg(m2 order by ano desc))[1]  as m2_fim,
           min(ano) as a0, max(ano) as a1
    from por_ano
  )
  select case when anos >= 2 then jsonb_build_object(
      'serie', serie,
      'valorizacao_periodo_pct', round(((m2_fim/nullif(m2_ini,0))-1)*100, 1),
      'valorizacao_aa_pct',      round((power((m2_fim/nullif(m2_ini,0)), 1.0/nullif(a1-a0,0))-1)*100, 1),
      'anos', anos, 'ano_inicial', a0, 'ano_final', a1)
    else null end
  from ag
$function$;

-- Só o service_role (backend) executa por ora. Quando a aba pública de consulta do
-- Índice existir, liberamos para authenticated. Revoga de PUBLIC (grant padrão).
revoke execute on function public.indice_valorizacao_anual(text,text,text,text,text,integer) from public, anon, authenticated;
grant  execute on function public.indice_valorizacao_anual(text,text,text,text,text,integer) to service_role;
