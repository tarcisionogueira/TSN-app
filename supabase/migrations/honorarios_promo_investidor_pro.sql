-- 16/09: upsell "Investidor Pro" oferecido junto ao link de honorários — o arrematante
-- autoriza o cartão agora e a 1ª cobrança da mensalidade só acontece 30 dias depois
-- (auto_recurring.start_date do Mercado Pago). Só funciona via cartão (assinatura recorrente
-- do MP não aceita PIX) — pedido/confirmação do dono, 16/09.
alter table public.arrematacoes
  add column if not exists promo_pro_mp_preapproval_id text,
  add column if not exists promo_pro_link text,
  add column if not exists promo_pro_inicio_em timestamptz;
