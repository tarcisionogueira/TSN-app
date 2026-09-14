-- 14/09: pedido do dono — a comissão do PARCEIRO no êxito de arrematação passa a ser 5% EM
-- CIMA do honorário de êxito (que é 10% do valor arrematado), ou seja 0,5% do valor
-- arrematado — não 5% do valor arrematado. Era 1% do valor arrematado antes desta mudança
-- (então é uma REDUÇÃO, de 1% para 0,5%). O total do honorário de êxito continua 10% (não
-- muda); o que sobra depois do parceiro (antes 9%, agora 9,5%) segue dividido meio a meio
-- entre advogado e plataforma — calcularDistribuicao() em api/_honorarios.js já faz essa
-- conta de forma proporcional (não precisa mudar código, só o dado). Confirmado com o dono:
-- os outros percentuais do parceiro (25% assinaturas/cursos/ebooks, 10% assessoria/clube)
-- continuam os mesmos — só este muda.
-- Termos atualizados no mesmo commit: ConviteParceiro.jsx (item 3d + TERMO_PARCEIRO_VERSAO)
-- e TermoJuridico.jsx (item 6 + TERMO_JURIDICO_VERSAO), que citam o percentual por extenso.
--
-- admin_pct/advogado_pct TAMBÉM mudam aqui (4,5 → 4,75 cada), mesmo NÃO sendo lidos por
-- calcularDistribuicao() (api/_honorarios.js) — são só "registro do acordo vigente", mas o
-- painel Admin (Admin.jsx, aba Honorários) valida ao vivo que admin+advogado+analista+
-- consultor SOMEM total_pct. A soma registrada tem de acompanhar o mesmo cenário (COM
-- parceiro) que consultor_pct usa, senão a tela mostraria soma quebrada.
update public.config_honorarios
   set consultor_pct = 0.50, admin_pct = 4.75, advogado_pct = 4.75, atualizado_em = now()
 where id = 1;
