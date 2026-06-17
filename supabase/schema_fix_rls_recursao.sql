-- ============================================================
-- Corrige recursão infinita nas políticas RLS de perfis
-- Sintoma: usuário admin aparece como "aluno" no app porque o
-- SELECT em perfis falha (erro 42P17) e o fetchRole cai no default.
-- Execute no SQL Editor do Supabase.
-- ============================================================

-- 1. Função que verifica admin SEM acionar RLS (security definer)
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfis where id = auth.uid() and role = 'admin'
  );
$$;

-- 2. Função que verifica papéis da "equipe" (analista/advogado/admin)
create or replace function public.is_equipe()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and role in ('analista','advogado','admin')
  );
$$;

-- 3. Recria as políticas de perfis sem recursão
drop policy if exists "Admin lê todos"               on public.perfis;
drop policy if exists "Admin lê todos os perfis"      on public.perfis;
drop policy if exists "Usuário lê próprio perfil"     on public.perfis;
drop policy if exists "Usuário atualiza próprio perfil" on public.perfis;
drop policy if exists "Admin atualiza perfis"         on public.perfis;

create policy "Usuário lê próprio perfil" on public.perfis
  for select using (auth.uid() = id);

create policy "Admin lê todos os perfis" on public.perfis
  for select using (public.is_admin());

create policy "Usuário atualiza próprio perfil" on public.perfis
  for update using (auth.uid() = id);

create policy "Admin atualiza perfis" on public.perfis
  for update using (public.is_admin());

-- 4. Atualiza as políticas das tabelas do workflow para usar is_equipe()
--    (evita recursão e centraliza a checagem de papel)
drop policy if exists "Analista/admin vê todas"        on public.solicitacoes;
drop policy if exists "Analista/admin atualiza"        on public.solicitacoes;
create policy "Analista/admin vê todas" on public.solicitacoes
  for select using (public.is_equipe());
create policy "Analista/admin atualiza" on public.solicitacoes
  for update using (public.is_equipe());

drop policy if exists "Analista/admin vê todos agendamentos" on public.agendamentos;
drop policy if exists "Analista/admin aprova agendamento"    on public.agendamentos;
create policy "Analista/admin vê todos agendamentos" on public.agendamentos
  for select using (public.is_equipe());
create policy "Analista/admin aprova agendamento" on public.agendamentos
  for update using (public.is_equipe());
