-- PLANO PAGO ACIMA DO TETO VIRA ABSOLUTO (dono, 09/08).
--
-- Pedido: "nas regras de saque o plano pago deve ser exigido para todos para que possam
-- fazer saques superiores a 2.500/mês".
--
-- O QUE MUDA DE VERDADE — vale registrar, porque é menos do que parece:
-- o dono observou, na sequência, que "todos podem se tornar parceiro e somente o parceiro
-- pode indicar e ganhar". Está certo, e isso significa que para DINHEIRO DE COMISSÃO os
-- escopos 'parceiro' e 'todos' são equivalentes: quem tem comissão a sacar É parceiro, por
-- definição. A mudança só morde num caso: o HONORÁRIO POR FUNÇÃO da equipe operacional
-- (analista/advogado/consultor recebendo por trabalho prestado, não por indicação), que cai
-- no mesmo ledger desde o saque unificado. Antes a equipe era isenta de assinar plano; agora
-- não é.
--
-- CONSEQUÊNCIA DITA EM VOZ ALTA: isso alcança o próprio dono e a equipe. Um analista sem
-- plano pago fica limitado a R$ 2.500/mês de honorário sacado. Abaixo do teto nada muda para
-- ninguém. Para voltar a isentar só a equipe, sem tocar em código:
--   update regra_negocio set valor = jsonb_set(valor,'{escopo}','"parceiro"')
--    where chave = 'saque.acima_do_teto';
--
-- A isenção da equipe SEGUE valendo para o aceite dos Termos de parceiro — ali a razão é
-- outra (recebe por função, não por adesão ao programa) e o dono não pediu para mudar.

begin;

update public.regra_negocio
   set valor = jsonb_build_object('exige_pagante', true, 'exige_nf', true, 'escopo', 'todos'),
       descricao = 'O que passa a ser exigido depois de estourar o teto do mês: estar em plano pago E anexar nota fiscal (conferida pela IA). ESCOPO: TODOS, sem exceção de classe — parceiro grátis, parceiro pagante e equipe operacional. Passou a ser absoluto em 09/08 a pedido do dono; antes a equipe era isenta de assinar plano.'
 where chave = 'saque.acima_do_teto';

update public.regra_negocio
   set valor = jsonb_build_object('valor', 2500, 'janela', 'mes', 'escopo', 'todos',
                                  'nf_cobre', 'total_do_mes', 'exige_pagante_escopo', 'todos'),
       descricao = 'Teto de saque, por mês-calendário, que dispensa nota fiscal. ABSOLUTO: vale para TODA classe, inclusive equipe. Acima do teto exige (a) plano pago e (b) nota fiscal do VALOR INTEGRAL SACADO NO MÊS (ja_sacado + este pedido), não só do excedente: quem sacou 3× R$ 1.000 sem nota e pede mais R$ 500 precisa de nota de R$ 3.500. Desde 09/08 a exigência de plano pago também é para todos. Para virar teto vitalício, troque "janela" para "vitalicio".'
 where chave = 'saque.teto_sem_nf';

commit;

-- O corpo novo de saque_avaliar() foi aplicado junto (migração
-- `saque_pagante_absoluto_acima_do_teto` no Supabase). A única linha que mudou de
-- comportamento é o gate do plano pago, que passou a ler o escopo da regra:
--
--   if coalesce((regra('saque.acima_do_teto')->>'exige_pagante')::boolean, true)
--      and not v_pagante
--      and (v_pag_escopo = 'todos' or not v_equipe) then ...
--
-- Antes era `and not v_pagante and not v_equipe` — equipe isenta em hardcode. Agora quem
-- decide é o dado, que é o padrão desta base desde a correção dos "dois cérebros".
--
-- Conferência (sem mexer em dinheiro nenhum):
--   select role, saque_avaliar(id, 3000)->>'precisa_assinar', saque_avaliar(id, 3000)->>'exige_nf'
--     from perfis where role in ('admin','explorador','top2');
--   -- admin/explorador → precisa_assinar = true · top2 (pagante) → exige_nf = true
