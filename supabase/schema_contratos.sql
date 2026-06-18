-- ============================================================
-- Contratos com assinatura digital nativa (sem integração externa)
-- + RLS de "modo suporte" (admin/analista visualizam contas)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ─── 1. Tabela de contratos ─────────────────────────────────
-- status: rascunho → aguardando_assinatura → assinado / cancelado
-- O aceite eletrônico é comprovado por: assinatura (PNG), timestamp,
-- hash SHA-256 do conteúdo+assinatura, e dados do assinante.
create table if not exists public.contratos (
  id                uuid default gen_random_uuid() primary key,
  cliente_id        uuid references auth.users(id) on delete set null,
  produto           text,                       -- 'assessoria','clube','curso','outro'
  titulo            text not null,
  conteudo          text not null,              -- corpo do contrato
  valor             numeric default 0,
  requer_assinatura boolean default true,       -- admin habilita se exige assinatura
  status            text default 'rascunho'
                      check (status in ('rascunho','aguardando_assinatura','assinado','cancelado')),
  assinatura_data   text,                        -- PNG base64 da assinatura do cliente
  assinante_nome    text,
  assinante_cpf     text,
  assinatura_hash   text,                        -- sha256(conteudo + assinatura + timestamp)
  assinado_em       timestamptz,
  criado_por        uuid references auth.users(id),
  criado_em         timestamptz default now()
);

alter table public.contratos enable row level security;

-- Cliente vê os próprios contratos
drop policy if exists "Cliente vê contratos" on public.contratos;
create policy "Cliente vê contratos" on public.contratos
  for select using (auth.uid() = cliente_id);

-- Cliente assina o próprio contrato (UPDATE restrito ao seu registro)
drop policy if exists "Cliente assina contrato" on public.contratos;
create policy "Cliente assina contrato" on public.contratos
  for update using (auth.uid() = cliente_id);

-- Equipe (admin/analista/advogado) vê todos os contratos
drop policy if exists "Equipe vê contratos" on public.contratos;
create policy "Equipe vê contratos" on public.contratos
  for select using (public.is_equipe());

-- Admin gerencia (cria/edita/exclui) contratos
drop policy if exists "Admin gerencia contratos" on public.contratos;
create policy "Admin gerencia contratos" on public.contratos
  for all using (public.is_admin());

create index if not exists idx_contratos_cliente on public.contratos(cliente_id);
create index if not exists idx_contratos_status  on public.contratos(status);

-- ─── 2. RLS de modo suporte ─────────────────────────────────
-- Permite que admin/analista leiam o perfil de qualquer cliente
-- (necessário para o "ver como" / suporte). As policies de
-- solicitacoes e agendamentos para equipe já existem em schema_analises.sql.
drop policy if exists "Equipe lê perfis" on public.perfis;
create policy "Equipe lê perfis" on public.perfis
  for select using (public.is_equipe());
