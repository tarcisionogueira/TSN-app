-- whatsapp_fila_grupo (SECURITY DEFINER) estava executavel por anon/authenticated (via o
-- grant padrao do Postgres a PUBLIC na criacao da funcao) e devolve PII (nome, telefone) de
-- inscritos em eventos ao vivo -- achado pela auditoria_seguranca() em 10/09.
-- Mesmo padrao ja usado em rpc_definer_revogar_anon.sql: revoke all ... from public, anon,
-- authenticated + grant explicito ao service_role, que e quem de fato chama
-- (api/admin-whatsapp-fila.js), mesmo padrao ja aplicado a whatsapp_fila_live.
revoke all on function public.whatsapp_fila_grupo(uuid, date) from public, anon, authenticated;
grant execute on function public.whatsapp_fila_grupo(uuid, date) to service_role;

revoke all on function public.whatsapp_fila_grupo(uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_fila_grupo(uuid, date, boolean) to service_role;
