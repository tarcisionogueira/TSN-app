-- 07/10 (decisão do dono): boleto do honorário de êxito até R$ 100 mil sai pelo MERCADO PAGO (mesma
-- tarifa de R$ 3,49 do Asaas, crédito mais rápido); acima, Asaas. O webhook do MP passa a gravar
-- `metodo = 'boleto_mp'` — sem este valor no CHECK o INSERT do recebimento é recusado (o webhook
-- devolve 502 e o MP reenvia, então nada se perde, mas a baixa só acontece depois desta migração).
alter table public.honorarios_recebimentos drop constraint if exists honorarios_recebimentos_metodo_check;
alter table public.honorarios_recebimentos add constraint honorarios_recebimentos_metodo_check
  check (metodo = any (array['pix_externo','pix_mp','pix_asaas','cheque','cartao_mp','cartao_asaas',
                             'boleto_asaas','boleto_mp','dinheiro','transferencia']));
