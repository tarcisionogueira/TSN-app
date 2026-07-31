-- CRÍTICO (bug bounty 31/07) — APLICADO em produção. A view public.saldo_usuarios é
-- SECURITY DEFINER (ignora o RLS das tabelas base) e expõe nome + chave_pix + saldo de
-- TODOS os usuários, SEM filtro por auth.uid(). anon e authenticated tinham SELECT →
-- qualquer um (inclusive SEM login) podia GET /rest/v1/saldo_usuarios e baixar as chaves
-- PIX e saldos de toda a base. Só o backend (service_role) usa a view (api/saque.js,
-- api/saldo-abandono-cron.js); nenhum front a consome. Revoga o acesso do cliente e liga
-- security_invoker (defesa em profundidade: passa a respeitar o RLS se o grant reaparecer).
alter view public.saldo_usuarios set (security_invoker = on);
revoke all on public.saldo_usuarios from anon;
revoke all on public.saldo_usuarios from authenticated;
grant select on public.saldo_usuarios to service_role;
