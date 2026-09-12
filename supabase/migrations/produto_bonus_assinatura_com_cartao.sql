-- Pedido do dono (12/09): "ebook por R$1 + 1 mês grátis de Investidor Pro, cobra o valor
-- cheio no mês 2 e mantém como assinatura". Diferente do mecanismo de cortesia que já existe
-- (concede_plano/concede_meses + conceder_plano_usuario, sem cartão, reverte se a pessoa não
-- assinar sozinha) — aqui o cartão é capturado NA COMPRA do produto, pra poder cobrar sozinho
-- depois. As duas formas convivem: um produto só vira "com cartão" se marcar a flag nova.

-- `requer_cartao_bonus`: liga o checkout com cartão embutido (ProdutoPublico.jsx) em vez do
-- redirecionamento de sempre, SÓ para este produto. Default false — nenhum produto existente
-- muda de comportamento.
alter table public.ebooks_admin
  add column if not exists requer_cartao_bonus boolean not null default false;
alter table public.cursos_admin
  add column if not exists requer_cartao_bonus boolean not null default false;

comment on column public.ebooks_admin.requer_cartao_bonus is 'true = checkout captura cartão na compra e agenda assinatura real (concede_plano/concede_meses) pra quando o bônus vencer. Ver api/mp.js (ação criar_compra_produto_cartao) e api/ativar-assinatura-bonus-cron.js.';
comment on column public.cursos_admin.requer_cartao_bonus is 'Mesmo campo de ebooks_admin.requer_cartao_bonus — ver o comentário lá.';

-- `compras_produtos` ganha onde guardar a referência do cartão salvo no Mercado Pago
-- (NUNCA o número do cartão — só os ids que o MP devolve) e o rastro da conversão real.
alter table public.compras_produtos
  add column if not exists mp_customer_id text,
  add column if not exists mp_card_id text,
  add column if not exists assinatura_id text,
  add column if not exists assinatura_ativada_em timestamptz,
  add column if not exists assinatura_falhou_em timestamptz,
  add column if not exists assinatura_falha_motivo text;

comment on column public.compras_produtos.mp_customer_id is 'Customer do Mercado Pago, criado na compra com cartão (requer_cartao_bonus) — permite gerar um token novo do MESMO cartão dias depois, sem pedir de novo.';
comment on column public.compras_produtos.mp_card_id is 'Cartão salvo no Customer acima. Nunca é o número do cartão — é a referência que o MP devolve.';
comment on column public.compras_produtos.assinatura_id is 'Preapproval do MP criado quando o bônus venceu e a cobrança virou assinatura de verdade — null enquanto ainda não converteu.';
comment on column public.compras_produtos.assinatura_ativada_em is 'Quando a conversão em assinatura de verdade aconteceu (api/ativar-assinatura-bonus-cron.js).';
comment on column public.compras_produtos.assinatura_falhou_em is 'Quando a tentativa de conversão falhou (cartão recusado etc.) — a cortesia reverte sozinha pelo mecanismo que já existe (plano_concedido_ate), esta coluna só é rastro para auditoria.';

-- Índice pro cron encontrar rápido "bônus vencendo, com cartão salvo, ainda não convertido".
create index if not exists compras_produtos_bonus_pendente_idx
  on public.compras_produtos (plano_concedido_ate)
  where mp_card_id is not null and assinatura_id is null;
