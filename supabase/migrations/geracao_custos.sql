-- CUSTO REAL POR GERAÇÃO (pergunta do dono, 06/08: "quanto custa em média cada relatório
-- e índice"). Até aqui a resposta só existia por ESTIMATIVA: `uso_integracoes` agrega por
-- provedor/operação/DIA, então num dia com 3 mercadológicos + 3 documentais o custo dos dois
-- se misturava e a média por relatório era inferida, não medida. O único ponto que gravava
-- o custo REAL de uma geração era `debitar_credito` — que só roda quando a cota mensal
-- acaba, e por isso tem 0 linhas: nenhum cliente esgotou a cota ainda.
--
-- Cada gerador já ACUMULA o custo real da própria geração (`_custoMicroReq`, somado a cada
-- resposta da IA). Aqui esse número passa a ser PERSISTIDO em toda geração, dando uma linha
-- por relatório/índice para sempre.
--
-- Efeito colateral que isso corrige: o painel de sustentabilidade aprendia o "custo por
-- análise" de `claude/web_search`. Quando o mercadológico migrou para o Gemini grounding,
-- essa métrica passou a medir o ÍNDICE (que continua no Claude), não o relatório — e a
-- conta de "quantas análises grátis um Pro banca" ficou ancorada no número errado.

create table if not exists public.geracao_custos (
  id bigserial primary key,
  funcao text not null,                 -- mercadologico | documental | laudo | indice
  user_id uuid,
  imovel_id text,                       -- ou a chave da consulta, no índice
  custo_micro bigint not null default 0,-- micro-USD medidos nesta geração
  ok boolean not null default true,     -- false = geração falhou/saiu vazia (custo gasto à toa)
  meta jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_geracao_custos_funcao_dia on public.geracao_custos (funcao, criado_em desc);

-- Custo é dado interno de operação: nenhum cliente lê esta tabela.
alter table public.geracao_custos enable row level security;
revoke all on public.geracao_custos from anon, authenticated;
grant all on public.geracao_custos to service_role;
grant usage, select on sequence public.geracao_custos_id_seq to service_role;

comment on table public.geracao_custos is
  'Custo REAL medido de cada geracao (mercadologico, documental, laudo, indice). Uma linha por geracao. Fonte de verdade do custo por relatorio.';

create or replace function public.registrar_geracao_custo(
  p_funcao text, p_user_id uuid, p_imovel_id text, p_custo_micro bigint, p_ok boolean, p_meta jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.geracao_custos (funcao, user_id, imovel_id, custo_micro, ok, meta)
  values (nullif(btrim(p_funcao),''), p_user_id, nullif(btrim(p_imovel_id),''), greatest(0, coalesce(p_custo_micro,0)), coalesce(p_ok,true), p_meta);
$$;
revoke all on function public.registrar_geracao_custo(text, uuid, text, bigint, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_geracao_custo(text, uuid, text, bigint, boolean, jsonb) to service_role;

-- A resposta direta a "quanto custa cada relatório". Mediana junto da média porque uma
-- geração que re-tentou puxa a média para cima e a mediana mostra o caso típico.
create or replace function public.custo_por_geracao(p_dias int default 30)
returns table (funcao text, n bigint, media_usd numeric, mediana_usd numeric, min_usd numeric, max_usd numeric, total_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select g.funcao,
         count(*),
         round((avg(g.custo_micro)::numeric)/1e6, 4),
         round(((percentile_cont(0.5) within group (order by g.custo_micro))::numeric)/1e6, 4),
         round((min(g.custo_micro)::numeric)/1e6, 4),
         round((max(g.custo_micro)::numeric)/1e6, 4),
         round((sum(g.custo_micro)::numeric)/1e6, 2)
    from public.geracao_custos g
   where g.ok and g.criado_em >= now() - make_interval(days => greatest(1, coalesce(p_dias, 30)))
   group by g.funcao
   order by 7 desc;
$$;
revoke all on function public.custo_por_geracao(int) from public, anon, authenticated;
grant execute on function public.custo_por_geracao(int) to service_role;

-- Série MENSAL do custo por geração. É o acompanhamento pedido pelo dono: a tese é que o
-- custo caia conforme a base própria cresce (mais relatório resolvido por comparativo
-- interno, menos busca na internet). Só dá para confirmar isso olhando a curva no tempo.
-- O DESPERDÍCIO (ok=false) vai na mesma linha de propósito: sem ele, uma queda na média
-- pode ser só falha barata disfarçada de eficiência.
create or replace function public.custo_geracao_mensal(p_meses int default 12)
returns table (mes text, funcao text, n bigint, media_usd numeric, total_usd numeric, desperdicio_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select to_char(date_trunc('month', g.criado_em), 'YYYY-MM') as mes,
         g.funcao,
         count(*) filter (where g.ok),
         round((avg(g.custo_micro) filter (where g.ok))::numeric/1e6, 4),
         round((sum(g.custo_micro) filter (where g.ok))::numeric/1e6, 2),
         round(coalesce(sum(g.custo_micro) filter (where not g.ok), 0)::numeric/1e6, 2)
    from public.geracao_custos g
   where g.criado_em >= date_trunc('month', now()) - make_interval(months => greatest(1, coalesce(p_meses,12)) - 1)
   group by 1, 2
   order by 1 desc, 5 desc;
$$;
revoke all on function public.custo_geracao_mensal(int) from public, anon, authenticated;
grant execute on function public.custo_geracao_mensal(int) to service_role;
