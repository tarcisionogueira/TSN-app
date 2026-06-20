-- ============================================================
-- Tabela relatorios — histórico de análises dos clientes
-- Execute no SQL Editor do Supabase
-- ============================================================

create table if not exists public.relatorios (
  id             uuid default uuid_generate_v4() primary key,
  user_id        uuid references auth.users(id) on delete cascade not null,
  imovel_id      text,                     -- ID do imóvel no imoveis_leilao (pode ser null se manual)
  imovel_nome    text,
  imovel_cidade  text,
  imovel_estado  text,
  valor_minimo   numeric,
  valor_avaliacao numeric,
  desconto_percentual integer,
  status         text default 'analise'
                   check (status in ('analise','aprovado','arrematado','em_reforma','venda','alugado','concluido','reprovado')),
  dados          jsonb,                    -- objeto completo da análise (d + metricas + mercado)
  parecer        text,                     -- laudo gerado
  arrematado     boolean default false,
  data_arrematacao timestamptz,
  expira_em      timestamptz,             -- null = permanente (arrematados), senão +90 dias
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table public.relatorios enable row level security;

-- Cliente vê e edita apenas as próprias análises
create policy "Cliente vê próprios relatórios" on public.relatorios
  for select using (auth.uid() = user_id);

create policy "Cliente cria relatório" on public.relatorios
  for insert with check (auth.uid() = user_id);

create policy "Cliente atualiza próprio relatório" on public.relatorios
  for update using (auth.uid() = user_id);

-- Analista/admin vê todos
create policy "Analista/admin vê todos relatórios" on public.relatorios
  for select using (
    exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('analista','advogado','admin'))
  );

-- Índices
create index if not exists idx_relatorios_user    on public.relatorios(user_id);
create index if not exists idx_relatorios_status  on public.relatorios(status);
create index if not exists idx_relatorios_expira  on public.relatorios(expira_em);
create index if not exists idx_relatorios_criado  on public.relatorios(created_at desc);

-- Função para updated_at automático
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists set_relatorios_updated_at on public.relatorios;
create trigger set_relatorios_updated_at
  before update on public.relatorios
  for each row execute function public.handle_updated_at();
