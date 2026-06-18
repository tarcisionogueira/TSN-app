-- Colunas para controle de reativação e inadimplência
alter table public.perfis
  add column if not exists role_anterior text,
  add column if not exists inadimplente_desde date;

-- Função auxiliar para o webhook buscar usuário por email (auth.users)
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
