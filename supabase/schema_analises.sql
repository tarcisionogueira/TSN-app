-- ============================================================
-- Workflow Em Análise — Execute no SQL Editor do Supabase
-- ============================================================

-- ─── SOLICITAÇÕES DE AVALIAÇÃO ──────────────────────────────
create table if not exists public.solicitacoes (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  imovel_ref    text not null,      -- ID do imóvel no localStorage do cliente
  imovel_nome   text,
  imovel_cidade text,
  tipo          text not null check (tipo in ('mercadologica','edital','processual')),
  status        text default 'solicitado' check (status in ('solicitado','em_andamento','concluido','cancelado')),
  prazo_ate     timestamptz,        -- prazo 24h para o tipo processual
  analista_id   uuid references auth.users(id),
  resultado     text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.solicitacoes enable row level security;

create policy "Cliente vê próprias solicitações" on public.solicitacoes
  for select using (auth.uid() = user_id);

create policy "Cliente cria solicitação" on public.solicitacoes
  for insert with check (auth.uid() = user_id);

create policy "Cliente cancela própria solicitação" on public.solicitacoes
  for update using (auth.uid() = user_id);

create policy "Analista/admin vê todas" on public.solicitacoes
  for select using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('analista','advogado','admin'))
  );

create policy "Analista/admin atualiza" on public.solicitacoes
  for update using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('analista','advogado','admin'))
  );

-- ─── AGENDAMENTOS COM ANALISTA ──────────────────────────────
create table if not exists public.agendamentos (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references auth.users(id) on delete cascade,
  imovel_ref       text not null,
  imovel_nome      text,
  imovel_cidade    text,
  data_agendamento date not null,
  status           text default 'solicitado' check (status in ('solicitado','confirmado','encaminhado_juridico','cancelado')),
  aprovado_por     uuid references auth.users(id),
  aprovado_em      timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.agendamentos enable row level security;

create policy "Cliente vê próprios agendamentos" on public.agendamentos
  for select using (auth.uid() = user_id);

create policy "Cliente cria agendamento" on public.agendamentos
  for insert with check (auth.uid() = user_id);

create policy "Cliente atualiza próprio agendamento" on public.agendamentos
  for update using (auth.uid() = user_id);

create policy "Analista/admin vê todos agendamentos" on public.agendamentos
  for select using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('analista','advogado','admin'))
  );

create policy "Analista/admin aprova agendamento" on public.agendamentos
  for update using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('analista','advogado','admin'))
  );

-- ─── ÍNDICES E CONSTRAINTS ───────────────────────────────────
create index if not exists idx_solicitacoes_user   on public.solicitacoes(user_id);
create index if not exists idx_solicitacoes_status on public.solicitacoes(status);
create index if not exists idx_agendamentos_user   on public.agendamentos(user_id);
create index if not exists idx_agendamentos_status on public.agendamentos(status);

