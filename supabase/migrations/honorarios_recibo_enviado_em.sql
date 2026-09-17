-- 17/09, pedido do dono: ao honorário fechar (soma dos recebimentos bate o total), mandar
-- ao arrematante um e-mail-recibo discriminando a operação (cada parte recebida + o imóvel).
-- Esta coluna é a trava de idempotência — sem ela, dois eventos quase simultâneos que fecham
-- o mesmo honorário (ex.: um recebimento manual e o webhook do cartão numa corrida) mandariam
-- o recibo em dobro. O PATCH que grava aqui só acontece com `WHERE ... IS NULL`, então só o
-- primeiro a chegar consegue gravar (e portanto só ele envia).
alter table public.arrematacoes
  add column if not exists honorarios_recibo_enviado_em timestamptz;
