-- ============================================================
-- RLS FIX — Auditoria de Segurança e LGPD
-- Execute no SQL Editor do painel Supabase
-- ============================================================

-- ─── contratos_link: acesso do assinante pelo e-mail ────────
-- A política existente (schema_contratos_link.sql) permite que QUALQUER pessoa
-- leia contratos com status='aguardando' pelo token público. Isso é necessário
-- para a página de assinatura externa funcionar sem login.
--
-- Problema: usuários autenticados que acessam /contratos (Contratos.jsx)
-- fazem query por assinante_email = auth.email() diretamente no cliente,
-- mas não há política RLS cobrindo esse caso para leitura autenticada.
-- Sem esta política, a query retorna vazio (RLS bloqueia) mesmo que o e-mail bata.

drop policy if exists "Assinante lê próprios contratos_link" on public.contratos_link;
create policy "Assinante lê próprios contratos_link" on public.contratos_link
  for select
  using (assinante_email = auth.email());

-- Permite que o assinante atualize (assinar) apenas o próprio contrato aguardando
drop policy if exists "Assinante pode assinar próprio contrato_link" on public.contratos_link;
create policy "Assinante pode assinar próprio contrato_link" on public.contratos_link
  for update
  using (
    assinante_email = auth.email()
    and status = 'aguardando'
    and expira_em > now()
  )
  with check (
    assinante_email = auth.email()
  );

-- ─── perfis: verificação de políticas existentes ────────────
-- As políticas abaixo já devem existir (schema.sql), mas re-declaramos
-- com DROP IF EXISTS para garantir consistência.

drop policy if exists "Usuário lê próprio perfil" on public.perfis;
create policy "Usuário lê próprio perfil" on public.perfis
  for select
  using (auth.uid() = id);

drop policy if exists "Usuário atualiza próprio perfil" on public.perfis;
create policy "Usuário atualiza próprio perfil" on public.perfis
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Nota: a política "Admin lê todos" em schema.sql usa subconsulta recursiva
-- que pode causar recursão infinita. Se houver erros de RLS recursivo,
-- aplique schema_fix_rls_recursao.sql primeiro.
