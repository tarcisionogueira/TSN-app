-- 16/09: link de pagamento (Mercado Pago Checkout Pro) para o arrematante pagar os
-- honorários de êxito — PIX ou cartão, à sua escolha, na página hospedada do MP.
-- Pedido do dono: "atribuir arremate" hoje calcula honorarios_valor mas não tem NENHUM
-- jeito de cobrar o cliente — honorarios_status='pago' nunca era setado por código algum
-- (grep confirmou). Estas colunas guardam o rastro de QUEM pagou e QUANDO, para o
-- webhook (api/mp-webhook.js) confirmar e para a distribuição interna (api/arrematacoes.js
-- distribuirHonorarios) exigir pagamento antes de creditar a equipe.
alter table public.arrematacoes
  add column if not exists honorarios_pago_em timestamptz,
  add column if not exists honorarios_gateway_payment_id text,
  add column if not exists honorarios_mp_preference_id text;
