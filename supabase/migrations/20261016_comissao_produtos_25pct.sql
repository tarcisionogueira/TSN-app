-- Comissão de indicação em CURSOS e E-BOOKS = 25% (16/10, confirmado pelo dono: "25% sobre cursos e
-- e-books indicados, 10% sobre assessorias e honorário de êxito").
--
-- Encontrado ao conferir o banco contra a regra: dois e-books PAGOS (R$ 29,90) estavam com
-- comissao_pct = 0 — o parceiro que vendesse não ganhava nada, contra o item 3(b) do Termo do Parceiro,
-- que promete 25%. E dois cursos INATIVOS estavam com 30%: reativados, pagariam acima da regra.
-- Produto paga NÍVEL ÚNICO com o comissao_pct do próprio produto (regra comissao.atribuicao_produto).
update public.ebooks_admin set comissao_pct = 25 where comissao_pct is distinct from 25;
update public.cursos_admin set comissao_pct = 25 where comissao_pct is distinct from 25;
