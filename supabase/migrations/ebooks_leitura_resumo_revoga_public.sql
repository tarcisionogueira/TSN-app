-- 14/09: achado do ritual de abertura — auditoria_seguranca() (check rpc_definer_anon) flagou
-- ebooks_leitura_resumo() como SECURITY DEFINER executavel por anon, fora da allowlist. A
-- migracao original (admin_ebooks_leitura.sql) so deu `grant execute ... to service_role` e
-- nunca revogou o grant padrao do Postgres para PUBLIC (toda funcao nova recebe EXECUTE a
-- PUBLIC por padrao) — por isso revogar so de anon nao bastaria, PUBLIC continua concedendo.
-- E funcao interna (o wrapper admin_ebooks_leitura ja faz o gate de role e chama esta via
-- SECURITY DEFINER, entao roda com o privilegio do DONO da funcao, nao do chamador — revogar
-- de PUBLIC nao quebra o wrapper). Nao devolve PII, mas nao tem motivo de ser publica.
revoke execute on function public.ebooks_leitura_resumo() from public;
