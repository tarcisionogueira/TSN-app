-- Recibo/comprovante do repasse (pedido do dono): ao PAGAR um saque, o admin anexa o
-- comprovante da transferência do Mercado Pago + uma descrição breve. Fica guardado no
-- lançamento e visível para o parceiro no extrato. Não bloqueia o pagamento (é registro).
alter table public.saldo_lancamentos add column if not exists comprovante_url  text;        -- URL assinada do comprovante (bucket documentos)
alter table public.saldo_lancamentos add column if not exists comprovante_desc text;        -- descrição breve do pagamento
alter table public.saldo_lancamentos add column if not exists pago_em          timestamptz; -- quando foi marcado pago
alter table public.saldo_lancamentos add column if not exists pago_por         uuid;        -- admin que registrou o pagamento
