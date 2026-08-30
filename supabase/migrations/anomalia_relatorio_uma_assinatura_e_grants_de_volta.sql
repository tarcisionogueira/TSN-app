-- 29/08 — DOIS DEFEITOS QUE O `create or replace` COM ASSINATURA NOVA CRIOU, E A AUDITORIA PEGOU
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Ao acrescentar `p_resolvido` eu não substituí a função: criei uma SEGUNDA. Consequências:
--
--  1. AMBIGUIDADE. Como o parâmetro novo tem DEFAULT, uma chamada com 5 argumentos serve às
--     duas assinaturas — e o Postgres recusa por ambiguidade. Qualquer chamador que ainda não
--     mande `p_resolvido` quebraria em produção, e o `registrarAnomalia` é best-effort
--     (`catch` vazio): quebraria EM SILÊNCIO, que é a pior forma.
--  2. GRANT PERDIDO. A antiga tinha ACL apertada (postgres + service_role). A nova nasceu com o
--     default do banco — `anon=X`, executável por anônimo. `auditoria_seguranca()` acusou
--     `rpc_definer_anon` na mesma hora, que é ela fazendo exatamente o trabalho dela.
--
-- Lição para a próxima: mudar assinatura de função SECURITY DEFINER **cria objeto novo**, não
-- edita o existente — os grants NÃO acompanham, e a antiga fica viva no caminho.
drop function if exists public.registrar_anomalia_relatorio(text, text, text, text, text);

revoke all on function public.registrar_anomalia_relatorio(text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.registrar_anomalia_relatorio(text, text, text, text, text, boolean)
  to service_role;

revoke all on function public.promover_para_assessorado(uuid, text) from public, anon, authenticated;
grant execute on function public.promover_para_assessorado(uuid, text) to service_role;
