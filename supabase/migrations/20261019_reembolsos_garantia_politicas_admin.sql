-- Forma 7b (CLAUDE.md): as políticas admin de `reembolsos_garantia` existiam em produção mas em
-- NENHUMA migração do repositório — recriar o banco a partir de supabase/migrations/ deixaria a tela
-- admin de reembolsos lendo [] sem erro (RLS filtra, não falha). Texto copiado de pg_policies em 19/10.
-- Idempotente: só cria o que não existe; não altera política já presente.

alter table public.reembolsos_garantia enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'reembolsos_garantia' and policyname = 'admin_reembolsos_select'
  ) then
    create policy admin_reembolsos_select on public.reembolsos_garantia
      as permissive for select to public
      using (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'reembolsos_garantia' and policyname = 'admin_reembolsos_update'
  ) then
    create policy admin_reembolsos_update on public.reembolsos_garantia
      as permissive for update to public
      using (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));
  end if;
end $$;
