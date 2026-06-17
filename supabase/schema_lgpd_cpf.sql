-- ============================================================
-- LGPD + unicidade de CPF — Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Colunas para registrar o consentimento LGPD no perfil
alter table public.perfis add column if not exists lgpd_aceito boolean default false;
alter table public.perfis add column if not exists lgpd_data   timestamptz;

-- 2. Recria o trigger de criação de perfil:
--    - normaliza o CPF (só dígitos) para a constraint UNIQUE funcionar de verdade
--    - grava o consentimento LGPD vindo do metadata do cadastro
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  cpf_limpo text;
begin
  cpf_limpo := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf',''), '\D', '', 'g'), '');

  insert into public.perfis (id, nome, cpf, telefone, endereco, role, lgpd_aceito, lgpd_data)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    cpf_limpo,
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    coalesce(new.raw_user_meta_data->>'role', 'explorador'),
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3. Garante o índice único de CPF (já existe via "cpf text unique", mas reforça)
do $$ begin
  if not exists (select 1 from pg_indexes where tablename='perfis' and indexname='perfis_cpf_unico') then
    create unique index perfis_cpf_unico on public.perfis (cpf) where cpf is not null;
  end if;
end $$;

-- Observação sobre login com Google:
-- O e-mail em auth.users já é único (1 conta por e-mail). O Supabase vincula
-- automaticamente o login Google a uma conta existente quando o e-mail é o mesmo
-- e está confirmado. Garanta em Authentication > Providers que "Confirm email"
-- esteja ativo para que o vínculo automático ocorra.
