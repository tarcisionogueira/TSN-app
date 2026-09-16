-- 16/09: pedido do dono — a cobrança dos honorários de êxito deixa de ser um link hospedado
-- do Mercado Pago e passa a ser um checkout TRANSPARENTE (nossa própria página, nossas
-- cores), reaproveitando api/mp-checkout.js + PagamentoServico.jsx. O upsell "Investidor Pro"
-- deixa de gerar uma assinatura hospedada separada: o cartão usado para pagar os honorários é
-- salvo (Customer+Card do MP, mesmo mecanismo de produto_bonus) e um cron (mirror de
-- ativar-assinatura-bonus-cron.js) tenta a 1ª cobrança da mensalidade 30 dias depois.
alter table public.arrematacoes
  drop column if exists honorarios_mp_preference_id,
  drop column if exists honorarios_link_pagamento,
  drop column if exists honorarios_link_expira_em,
  drop column if exists promo_pro_link,
  add column if not exists promo_pro_mp_customer_id text,
  add column if not exists promo_pro_mp_card_id text;
