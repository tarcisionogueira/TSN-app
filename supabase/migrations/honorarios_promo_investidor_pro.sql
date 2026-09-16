-- 16/09: upsell "Investidor Pro" oferecido junto ao link de honorários — o arrematante
-- autoriza o cartão agora e a 1ª cobrança da mensalidade só acontece 30 dias depois
-- (auto_recurring.start_date do Mercado Pago). Só funciona via cartão (assinatura recorrente
-- do MP não aceita PIX) — pedido/confirmação do dono, 16/09.
--
-- `promo_pro_link` foi removido em migração posterior (honorarios_checkout_transparente_reforma):
-- a versão final não gera um segundo link — salva o cartão no MESMO checkout dos honorários
-- (ver promo_pro_mp_customer_id/promo_pro_mp_card_id) e usa `promo_pro_inicio_em` como a data em
-- que o cron deve tentar a 1ª cobrança, em vez de um preapproval hospedado com start_date.
alter table public.arrematacoes
  add column if not exists promo_pro_mp_preapproval_id text,
  add column if not exists promo_pro_link text,
  add column if not exists promo_pro_inicio_em timestamptz;
