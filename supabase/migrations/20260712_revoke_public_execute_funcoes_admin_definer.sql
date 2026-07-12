-- Auditoria 12/07 (pilar 2 — "não pode ter acesso aos dados de outros usuários").
--
-- BUG das migrações anteriores: elas fizeram
--   revoke execute on function ... from anon, authenticated;
-- o que é INEFETIVO no Postgres. Na criação de uma função o EXECUTE é concedido a
-- PUBLIC por padrão; anon/authenticated herdam desse PUBLIC. Revogar de um papel
-- específico NÃO remove o grant herdado de PUBLIC — a ACL continuava com `=X`
-- (PUBLIC) e a função seguia chamável por qualquer um via /rest/v1/rpc/...
--
-- Impacto real (antes desta correção): QUALQUER pessoa, inclusive anônima, podia
-- POST em /rest/v1/rpc/admin_usuario_360 { "uid": "<qualquer uuid>" } e receber o
-- retrato 360º (perfil + e-mail + último acesso + atividade) de OUTRO usuário; e em
-- /rest/v1/rpc/admin_busca_usuarios { "termo": "a" } e listar nome/e-mail/plano —
-- contornando o endpoint admin-gated api/admin-usuario-360.js.
--
-- Correção real: REVOKE ... FROM PUBLIC. Só a service_role (endpoints server-side
-- que já validam admin/analista) mantém EXECUTE.
--
-- NÃO tocamos is_admin()/is_equipe()/app_role() (necessárias à RLS, operam só sobre
-- auth.uid()) nem as funções self-guarded de convite/indicação/imovel_visto.

revoke execute on function public.admin_busca_usuarios(text) from public;
revoke execute on function public.admin_usuario_360(uuid) from public;
grant execute on function public.admin_busca_usuarios(text) to service_role;
grant execute on function public.admin_usuario_360(uuid) to service_role;

-- Internas (pilar 3 — fluxo do sistema): agregado de demanda e auditoria de runtime
-- só rodam server-side (api/diagnostico-ia.js e scripts/auditoria-claude.mjs usam a
-- service key). Mesmo bug de PUBLIC herdado — fecha o vazamento de dados internos.
revoke execute on function public.demanda_busca_agregada() from public;
revoke execute on function public.auditoria_funcionamento() from public;
grant execute on function public.demanda_busca_agregada() to service_role;
grant execute on function public.auditoria_funcionamento() to service_role;
