-- Corrige a tabela perfis para suportar os 9 roles do sistema
-- Execute no SQL Editor do Supabase

-- 1. Remove a constraint antiga (que só permitia admin/aluno/assessor/advogado/atendente)
alter table public.perfis
  drop constraint if exists perfis_role_check;

-- 2. Adiciona nova constraint com todos os 9 roles
alter table public.perfis
  add constraint perfis_role_check
  check (role in ('admin','explorador','top1','top2','assessorado','clube','consultor','analista','advogado'));

-- 3. Migra roles antigos para os novos equivalentes
update public.perfis set role = 'explorador' where role = 'aluno';
update public.perfis set role = 'analista'   where role = 'assessor';
update public.perfis set role = 'advogado'   where role = 'atendente';

-- 4. Política para admin atualizar qualquer perfil (via painel admin)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='perfis' and policyname='Admin atualiza perfis') then
    create policy "Admin atualiza perfis" on public.perfis for update
      using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

-- 5. Política para admin ler todos os perfis (para o painel de Usuários)
do $$ begin
  if not exists (select 1 from pg_policies where tablename='perfis' and policyname='Admin le todos perfis') then
    create policy "Admin le todos perfis" on public.perfis for select
      using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;
