-- 16/09: permite anexar uma descrição livre ao documento (pedido do dono — o
-- comprovante de pagamento do leiloeiro varia de propósito: sinal, saldo, taxa,
-- ITBI... sem descrição, a lista fica só com o tipo genérico e o rótulo some na
-- rastreabilidade). Opcional, nunca sobrescreve nada existente por omissão.
alter table public.imovel_anexos
  add column if not exists descricao text;

comment on column public.imovel_anexos.descricao is
  'Descrição livre opcional informada por quem anexou (ex.: "comprovante do sinal", "taxa do leiloeiro") — pedido do dono, 16/09.';
