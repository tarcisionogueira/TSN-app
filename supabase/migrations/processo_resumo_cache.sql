-- RESUMO EM LINGUAGEM SIMPLES do andamento processual (24/09, pedido do dono).
-- A consulta do CNJ no arremate devolvia movimentação crua e publicações em juridiquês; agora a IA
-- (Haiku) resume "o que aconteceu desde a arrematação e o que vem a seguir". Cache por
-- (processo, hash do que foi lido): consultar de novo sem publicação nova NÃO chama a IA de novo.
-- Só o servidor lê/escreve (service key) — RLS ligada e sem política.
create table if not exists public.processo_resumo_cache (
  numero_processo text not null,
  hash text not null,
  resumo jsonb not null,
  modelo text,
  criado_em timestamptz not null default now(),
  primary key (numero_processo, hash)
);
alter table public.processo_resumo_cache enable row level security;
revoke all on public.processo_resumo_cache from anon, authenticated;
