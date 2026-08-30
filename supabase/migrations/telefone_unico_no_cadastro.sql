-- 30/08 — TELEFONE ÚNICO NO CADASTRO (pedido do dono, depois do duplicado do Fabrício)
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Regra pedida: e-mail, telefone e CPF únicos. CNPJ NÃO — a mesma empresa pode ter mais de
-- um sócio cadastrado.
--
-- LEVANTADO ANTES DE MEXER, e dois dos três já estavam prontos:
--   e-mail ..... já único em `auth.users` (garantia do próprio Supabase)
--   CPF ........ já único, com TRÊS índices (`perfis_cpf_key`, `perfis_cpf_unico`,
--                `perfis_cpf_hash_unico`) — redundantes, mas funcionando
--   telefone ... NENHUM índice. Era o que faltava.
--
-- ─── A NORMALIZAÇÃO É O QUE FAZ A TRAVA EXISTIR ──────────────────────────────────────────
-- O índice é sobre `regexp_replace(telefone,'\D','','g')`, não sobre a coluna crua.
-- `(11) 99999-0001` e `11999990001` são o MESMO número e strings DIFERENTES: um índice sobre
-- a coluna crua deixaria os dois entrarem e a trava não pegaria nada — daria a sensação de
-- proteção sem proteger, que é pior que não ter. Testado: com o índice no ar, inserir o
-- telefone formatado contra o já existente sem formatação é recusado.
--
-- ─── POR QUE DOIS IDS FICAM DE FORA ──────────────────────────────────────────────────────
-- Já existem 2 pares duplicados (Igor 06/07, Fabrício 30/08) e um índice único simplesmente
-- NÃO SERIA CRIADO com eles ali. A saída não foi apagar dado de cliente — foi excluir do
-- índice a SEGUNDA conta de cada par. A PRIMEIRA de cada fica DENTRO, então uma TERCEIRA
-- tentativa com o mesmo telefone é barrada normalmente. Fundir as contas é decisão do dono.
--
-- ⚠️ PENDÊNCIA DE INTERFACE, e ela importa. A violação chega ao front como erro cru de
-- constraint. Se um cliente real tentar cadastrar com telefone já usado, ele vê uma mensagem
-- técnica — exatamente o tipo de tela que faz a pessoa tentar de novo com outro e-mail, que é
-- COMO O DUPLICADO DO FABRÍCIO NASCEU. A trava precisa de uma mensagem: "esse telefone já tem
-- cadastro — entre com o e-mail X ou recupere a senha".
create unique index if not exists perfis_telefone_unico
    on public.perfis (regexp_replace(telefone, '\D', '', 'g'))
 where telefone is not null
   and length(regexp_replace(telefone, '\D', '', 'g')) >= 10
   and id not in ('d8786f6f-3a56-4add-aaa7-27ed342cc178',
                  '6eaaee89-d186-4e4c-9428-7d24187dc5be');
