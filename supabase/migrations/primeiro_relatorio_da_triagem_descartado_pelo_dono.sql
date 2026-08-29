-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DESCARTADO PELO DONO, no mesmo dia em que nasceu — 29/08.
--
-- A proposta era: ao terminar a triagem, o cliente cair num relatório já em geração, com o lote
-- escolhido pelo servidor a partir do objetivo e da faixa de capital que ele acabara de declarar.
-- O dono olhou o painel e recusou, com a razão que a medição não alcança:
--
--     "o cliente não escolheu o imóvel, viria um imóvel avulso que muito provavelmente não
--      seria do interesse dele"
--
-- Vale registrar porque o número enganava para o outro lado: o ensaio em seco tinha saído
-- excelente (34 de 34 clientes reais com lote, 21 na própria cidade, 0 fora do estado, 34 com
-- documento) e nada nele mediria a única coisa que importava — o lote pode ser o mais aderente
-- do acervo e ainda assim ser um lote que a pessoa não pediu. Adesão não se compra entregando
-- algo que o cliente não escolheu.
--
-- Some tudo: função, regra e interruptor. O que FICA da frente é o item 2 (os eventos
-- `analise_estado` / `analise_gerar` / `analise_bloqueio` em `/analise`), que só observa.
-- ─────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.primeiro_imovel_para_triagem(uuid);
delete from public.regra_negocio where chave = 'ativacao.primeiro_relatorio';
delete from public.app_config  where key   = 'primeiro_relatorio_auto';
