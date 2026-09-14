-- 14/09: pedido do dono — a fatia do PARCEIRO no honorário de êxito de arrematação sobe de
-- 1% para 5% do valor arrematado. O total do honorário de êxito continua 10% (não muda);
-- o que sobra depois do parceiro (antes 9%, agora 5%) segue dividido meio a meio entre
-- advogado e plataforma — calcularDistribuicao() em api/_honorarios.js já faz essa conta
-- de forma proporcional (não precisa mudar código, só o dado). Confirmado com o dono: os
-- outros percentuais do parceiro (25% assinaturas/cursos/ebooks, 10% assessoria/clube)
-- continuam os mesmos — só este muda.
-- Termos atualizados no mesmo commit: ConviteParceiro.jsx (item 3d + TERMO_PARCEIRO_VERSAO)
-- e TermoJuridico.jsx (item 6 + TERMO_JURIDICO_VERSAO), que citam o percentual por extenso.
--
-- admin_pct/advogado_pct TAMBÉM mudam aqui (4,5 → 2,5 cada), mesmo NÃO sendo lidos por
-- calcularDistribuicao() (api/_honorarios.js) — são só "registro do acordo vigente", mas o
-- painel Admin (Admin.jsx, aba Honorários) valida ao vivo que admin+advogado+analista+
-- consultor SOMEM total_pct, e mostrava "10,00% / 10,00% ✓" com o acordo de ANTES da
-- mudança. Sem atualizar aqui, a tela passaria a mostrar "14,00% / 10,00% ✗" — a soma
-- registrada tem de acompanhar o mesmo cenário (COM parceiro) que consultor_pct usa.
update public.config_honorarios
   set consultor_pct = 5.00, admin_pct = 2.50, advogado_pct = 2.50, atualizado_em = now()
 where id = 1;
