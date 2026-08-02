-- `perfis` NÃO tem coluna `email` (o e-mail mora em auth.users). Pedir `email` no select/embed
-- faz o PostgREST devolver 400 e, como o front raramente checa `error`, a tela mostra VAZIO/ZERO
-- sem nenhum aviso. Já aconteceu uma vez (painel de Assinaturas "tudo 0", sessão 15 — corrigido em
-- AdminFinanceiro.jsx:331), mas a mesma consulta sobreviveu em 5 pontos do Admin.jsx e em
-- ImovelDetalhe.jsx. Achado do bug bounty 02/08.
--
-- Em vez de repetir o remendo, o servidor passa a expor o mapa id → e-mail para a equipe.
create or replace function public.admin_emails_por_ids(p_ids uuid[])
returns table (id uuid, email text)
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select u.id, u.email::text
    from auth.users u
   where u.id = any (coalesce(p_ids, '{}'::uuid[]))
     and (public.is_admin() or public.is_equipe());
$$;

comment on function public.admin_emails_por_ids(uuid[]) is
  'Mapa id → e-mail (auth.users) para as telas de equipe. perfis não tem coluna email; pedir email no PostgREST devolve 400 e a tela zera em silêncio. Guard: só admin/equipe.';

revoke all on function public.admin_emails_por_ids(uuid[]) from public;
revoke all on function public.admin_emails_por_ids(uuid[]) from anon;
grant execute on function public.admin_emails_por_ids(uuid[]) to authenticated;
