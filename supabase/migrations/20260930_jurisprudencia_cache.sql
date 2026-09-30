-- 30/09 — cache da pesquisa de jurisprudência (api/_jurisprudencia.js): mesma pergunta em 30 dias
-- não paga a busca de novo. Só o servidor lê/escreve.
create table if not exists public.jurisprudencia_cache (
  chave      text primary key,
  tema       text,
  resultado  jsonb not null,
  criado_em  timestamptz not null default now()
);
alter table public.jurisprudencia_cache enable row level security;
revoke all on public.jurisprudencia_cache from anon, authenticated;
