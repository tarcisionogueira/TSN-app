-- 22/09, pedido do dono: menu "Assessorados" (lista de clientes do plano assessorado + seus
-- arremates, pra monitorar/atualizar/anexar documento) visível só pro admin (vê todos) e pra
-- equipe (analista/advogado/consultor) — e para a equipe, SÓ o assessorado que foi
-- explicitamente designado a acompanhar. Não existia nenhuma tabela de designação por CLIENTE
-- (só por CASO, via casos.analista_id/advogado_id — granularidade diferente: um cliente pode
-- ter vários casos, e a designação pedida aqui é da PESSOA, não de um caso específico).
create table if not exists public.assessorado_designacao (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.perfis(id) on delete cascade,
  membro_id     uuid not null references public.perfis(id) on delete cascade,
  designado_por uuid references public.perfis(id),
  criado_em     timestamptz not null default now(),
  unique (cliente_id, membro_id)
);
create index if not exists assessorado_designacao_membro on public.assessorado_designacao (membro_id);
create index if not exists assessorado_designacao_cliente on public.assessorado_designacao (cliente_id);

alter table public.assessorado_designacao enable row level security;
-- Sem policy pra anon/authenticated: só api/admin-assessorados.js (service_role) lê/escreve,
-- mesmo padrão de processos_monitorados/regra_negocio — a autorização por role vive no
-- endpoint (getUserRoleById), não em RLS de cliente.

comment on table public.assessorado_designacao is
  'Quais membros da equipe (analista/advogado/consultor) foram designados a acompanhar qual cliente assessorado. Admin sempre vê todos, independente de designação.';
