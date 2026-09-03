-- meu_nivel() já tinha sido endurecido (rpc_meu_nivel_revogar_anon.sql, sessão anterior):
-- revoke de anon/public, grant só para authenticated. Depois disso, esta sessão fez um
-- DROP+CREATE para acrescentar o parâmetro p_uid (visão da equipe sobre outro parceiro) —
-- criar a função DE NOVO reseta os grants para o padrão do Postgres (EXECUTE a PUBLIC,
-- que flui para anon). auditoria_seguranca() voltou a acusar `rpc_definer_anon`. Mesmo
-- padrão de sempre: reaplicar o hardening na assinatura NOVA.
--
-- qa_invariante_editais_cruzamento_cego() nunca foi endurecida: é peça interna de
-- qa_invariantes() (chamada só internamente, com privilégio do dono da função — não
-- precisa de grant para isso) e nenhum código do frontend a chama via RPC direto.

revoke execute on function public.meu_nivel(uuid) from anon, public;
grant  execute on function public.meu_nivel(uuid) to authenticated;

revoke all on function public.qa_invariante_editais_cruzamento_cego() from public, anon, authenticated;
