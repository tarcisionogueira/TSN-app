-- Checa se um e-mail já existe no Auth, sem expor qual usuário.
-- Usada pela verificação de e-mail duplicado no cadastro, já que a tabela
-- perfis não armazena e-mail (decisão de privacidade do projeto).
create or replace function public.email_existe(p_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_existe(text) from public;
grant execute on function public.email_existe(text) to service_role;
