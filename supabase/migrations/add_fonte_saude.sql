-- Saúde das fontes de coleta (leiloeiros) — 1 linha por fonte por execução.
-- Base do monitor de regressão: se uma conexão que já funcionava quebra ou
-- muda (cai a 0, despenca, ou piora a qualidade), o cron compara com a
-- linha de base (mediana das execuções recentes) e dispara alerta.
create table if not exists public.fonte_saude (
  id            bigint generated always as identity primary key,
  fonte         text        not null,
  executado_em  timestamptz not null default now(),
  total         integer     not null default 0,
  -- estratégia da esteira que venceu (ex.: 'fetch-credentials', 'listener', 'brightdata')
  estrategia    text,
  -- métricas de qualidade (0..1)
  uf_pct        numeric(4,3) default 0,
  valor_pct     numeric(4,3) default 0,
  link_pct      numeric(4,3) default 0,
  foto_pct      numeric(4,3) default 0,
  -- ok | degradado | falhou
  status        text        not null default 'ok',
  motivo        text
);

create index if not exists idx_fonte_saude_fonte_data
  on public.fonte_saude (fonte, executado_em desc);

-- Só o service role escreve/lê (scraper e crons). Sem acesso público.
alter table public.fonte_saude enable row level security;
