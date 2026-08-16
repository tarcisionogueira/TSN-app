-- ============================================================================
-- REPARO: âncora `plano_pago_em` gravada SEM pagamento (16/08)
--
-- `perfis.plano_pago_em` é a âncora da garantia de 7 dias do CDC (art. 49) — a data
-- a partir da qual o cliente pode desistir e ser reembolsado. Ela só deveria ser
-- gravada com cobrança RECEBIDA.
--
-- O fluxo `assinar-com-cadastro.js` tratava `preapproval.status === 'authorized'`
-- (mandato aceito — validação de cartão de R$ 0,00) como pagamento, e o carimbo saía
-- junto. No 1º assinante Pro a cobrança de R$ 49,90 foi RECUSADA 22 minutos depois
-- (`cc_rejected_high_risk`), sem um centavo recebido, e a âncora ficou gravada.
--
-- Dois estragos, e o segundo é o que obriga o reparo agora:
--
--  1. A âncora "queima" a garantia. `ativarPlanoDireto` e `ativarRoleInline` só
--     carimbam na PRIMEIRA ativação (`if (!plano_pago_em)`). Se o MP conseguir cobrar
--     numa das próximas tentativas, os 7 dias já estariam correndo desde 16/08 — o
--     cliente pagaria com a janela pela metade, ou com ela vencida.
--
--  2. A âncora fura a trava nova. A guarda introduzida hoje em `ativarPlanoDireto`
--     libera sem cobrança quem TEM histórico de pagamento, e `plano_pago_em` é um dos
--     sinais desse histórico — existe para não prender cliente adimplente como
--     Explorador quando um webhook se perde. Com a âncora falsa no lugar, o próximo
--     evento de mandato daria ao não-pagante exatamente o acesso que a trava existe
--     para negar.
--
-- Condicionado à EVIDÊNCIA, não a um id: só limpa quem não tem nenhum pagamento
-- aprovado nem aceite de plano com valor. Idempotente — rodar de novo não faz nada.
-- ============================================================================

update public.perfis p
   set plano_pago_em = null
 where p.plano_pago_em is not null
   and p.role not in ('top2', 'assessorado', 'clube', 'admin', 'analista',
                      'advogado', 'suporte', 'consultor', 'gestor')
   and not exists (
     select 1 from public.aceites_plano a
      where a.user_id = p.id and a.valor > 0
   )
   and not exists (
     select 1 from public.mp_pagamentos m
      where m.user_id = p.id and m.status = 'approved' and m.valor > 0
   );
