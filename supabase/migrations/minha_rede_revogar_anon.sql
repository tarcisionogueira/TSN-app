-- Auditoria 30/07: minha_rede (SECURITY DEFINER) estava executável por anon (grant
-- default do PostgREST na criação). A função lê a árvore de indicações do próprio
-- usuário autenticado — anon não tem uso legítimo. Mesmo padrão do hardening
-- rpc_definer_revogar_anon (24/07). APLICADA em produção em 30/07.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'minha_rede'
  loop
    execute format('revoke all on function %s from public', f.assinatura);
    execute format('revoke all on function %s from anon', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;
