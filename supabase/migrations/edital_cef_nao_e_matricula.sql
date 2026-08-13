-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O BOTÃO "EDITAL" ABRIA A MATRÍCULA — 399 lotes da Caixa (13/08)
--
-- ACHADO: o invariante `edital_eq_matricula` (limite 8) marcou **399**, todos CEF, todos
-- `extrajudicial`. Somando os que apontam para o caminho da matrícula sem serem idênticos ao
-- `link_matricula`, são **410**. Exemplo real:
--     link_edital = https://venda-imoveis.caixa.gov.br/editais/matricula/AM/1444401910191.pdf
-- O cliente clicava em "Edital" e recebia a MATRÍCULA: outro documento, sem as regras do
-- leilão, e com cara de estar certo — nada na tela indicava a troca.
--
-- CAUSA: `scripts/backfill-edital-cef.mjs`, quando a página do lote não publica edital,
-- devolvia `sem_edital` e **não escrevia nada**. O `link_edital` antigo ficava valendo — e o
-- valor antigo, nesses lotes, era a URL da matrícula (montada estaticamente pela Caixa em
-- `/editais/matricula/<UF>/<numero>.pdf`). Ou seja: "a Caixa não publicou edital" era gravado
-- como "o edital é este outro documento aqui".
--
-- É a mesma família documentada no CLAUDE.md: uma AUSÊNCIA entregue como conteúdo válido.
-- A diferença é que aqui o conteúdo entregue existe e abre — o que torna o engano invisível.
--
-- CORREÇÃO NA RAIZ (mesmo commit): o backfill passa a gravar `link_edital = null` quando não
-- acha edital E o valor atual aponta para a matrícula. Com `null`, a tela diz "sem edital
-- publicado", que é a verdade.
--
-- ESTA MIGRAÇÃO limpa o acervo já contaminado. Não toca em `link_matricula`: a matrícula
-- continua acessível pelo botão dela, que é onde ela sempre deveria ter estado.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════════════

update public.imoveis_leilao
   set link_edital = null
 where fonte = 'CEF'
   and link_edital is not null
   and link_edital ilike '%/editais/matricula/%';

-- Verde = 0. (O invariante `edital_eq_matricula` tem limite 8 e deve voltar a 'ok'.)
-- select count(*) from imoveis_leilao
--  where ativo and link_edital is not null and link_edital ilike '%/editais/matricula/%';
