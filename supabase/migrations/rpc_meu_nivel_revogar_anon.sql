-- Hardening de RPC: meu_nivel() é função de PAINEL (usa auth.uid() e retorna
-- {ok:false, erro:'sem_sessao'} sem sessão) — não deve ser executável por anon.
-- Criada na sessão do Programa de Parceiros (26/07) sem revogar anon; o
-- auditoria_seguranca() a sinalizou como "rpc_definer_anon" (1 atenção).
-- Mesmo padrão do rpc_definer_revogar_anon (sessão 9). Idempotente.
-- Efeito: auditoria_seguranca() volta a 0 crítico / 0 atenção.

revoke execute on function public.meu_nivel() from anon, public;
grant  execute on function public.meu_nivel() to authenticated;
