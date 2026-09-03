-- Correção da migração anterior (garantia_7d_avaliar_exclui_pagamento_em_curso.sql): ela usou
-- CREATE OR REPLACE para acrescentar o parâmetro p_excluir_mp_payment_id — mas em Postgres,
-- acrescentar um parâmetro muda a IDENTIDADE da função (nome + tipos dos parâmetros), então
-- CREATE OR REPLACE não substituiu garantia_7d_avaliar(uuid): criou um SEGUNDO overload ao
-- lado do antigo (comprovado ao vivo: `select garantia_7d_avaliar(id) from perfis...` deu
-- "function ... is not unique"). Isso tem dois problemas:
--   1) o overload de 1 argumento continuava com o BUG original (nunca excluía o pagamento em
--      curso) — quem chamasse só com p_user_id podia cair nele em vez do corrigido;
--   2) a função NOVA (objeto novo) nasceu com o grant padrão do Postgres (EXECUTE a PUBLIC,
--      que flui para anon) — a MESMA classe de regressão silenciosa já vista nesta sessão em
--      meu_nivel(uuid). auditoria_seguranca() confirmou: 1 atenção (rpc_definer_anon).
--
-- Fix: derruba o overload de 1 argumento (só o de 2 argumentos, com default, sobrevive — e
-- PostgREST/SQL resolvem uma chamada com só p_user_id sem ambiguidade) e revoga anon/public
-- do sobrevivente (só o backend com service_role chama esta função; nenhum código do
-- frontend usa esta RPC diretamente).
drop function if exists public.garantia_7d_avaliar(uuid);

revoke all on function public.garantia_7d_avaliar(uuid, text) from public, anon, authenticated;
grant execute on function public.garantia_7d_avaliar(uuid, text) to service_role;
