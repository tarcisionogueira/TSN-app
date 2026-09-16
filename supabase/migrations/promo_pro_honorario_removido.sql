-- 18/09: o upsell "Investidor Pro" no checkout de honorários foi removido da tela (pedido do
-- dono — Assessoria já libera as cotas do Pro durante o período da operação, oferecer o Pro
-- avulso ali não fazia sentido). Nenhuma linha de `arrematacoes` chegou a usar estas colunas
-- (0 com promo_pro_mp_customer_id/card_id/inicio_em/preapproval_id não-nulo) — código morto
-- limpo junto: api/ativar-promo-pro-honorario-cron.js removido, cron tirado do vercel.json,
-- trecho de salvar-cartão-pro tirado de api/mp-checkout.js.
alter table public.arrematacoes
  drop column if exists promo_pro_mp_preapproval_id,
  drop column if exists promo_pro_inicio_em,
  drop column if exists promo_pro_mp_customer_id,
  drop column if exists promo_pro_mp_card_id;
