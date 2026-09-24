-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ANDAMENTO DO PROCESSO NO CASO (assessorados) — 24/09/2026, pedido do dono
--
-- A arrematação do assessorado corre em PRAZO PROCESSUAL: depois do arremate o caso fica
-- semanas/meses esperando auto de arrematação, carta, imissão — e o sistema não tinha onde
-- registrar em que passo cada um está (os 3 casos `arrematado` de 14/07, 21/07 e 16/09 estavam
-- sem nenhum rastro). Esta tabela é o diário do caso: cada linha = uma etapa registrada pelo
-- dono, manual ou a partir de uma movimentação consultada no CNJ (DataJud/DJEN) pelo botão
-- "Consultar andamento" (api/caso-andamento-cnj.js).
--
-- SÓ ADMIN (decisão do dono: "funciona somente para mim"). A tabela `casos` deixa o CLIENTE
-- atualizar o próprio caso (casos_update_consolidada), por isso o número do processo NÃO mora
-- em `casos`: vive aqui, em `numero_processo`, e o endpoint lê o mais recente.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.caso_andamentos (
  id              uuid primary key default gen_random_uuid(),
  caso_id         uuid not null references public.casos(id) on delete cascade,
  etapa           text not null check (length(btrim(etapa)) between 2 and 200),
  observacao      text check (observacao is null or length(observacao) <= 4000),
  origem          text not null default 'manual' check (origem in ('manual', 'cnj', 'djen')),
  numero_processo text,
  data_evento     date,
  referencia      jsonb,          -- movimento/publicação do CNJ que originou a linha (data, descrição, tribunal)
  autor_id        uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em       timestamptz not null default now()
);

create index if not exists caso_andamentos_caso_idx on public.caso_andamentos (caso_id, criado_em desc);

alter table public.caso_andamentos enable row level security;

drop policy if exists caso_andamentos_admin on public.caso_andamentos;
create policy caso_andamentos_admin on public.caso_andamentos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- GRANT explícito (Supabase: tabela nova em public exige GRANT a partir de 30/10).
grant select, insert, update, delete on public.caso_andamentos to authenticated;
revoke all on public.caso_andamentos from anon;

comment on table public.caso_andamentos is
  'Diario do caso (etapa processual pos-arremate). Admin-only. Origem manual ou movimentacao do CNJ/DJEN consultada sob demanda.';
