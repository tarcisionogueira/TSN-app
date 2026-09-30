-- 30/09 — Honorário de êxito por BOLETO do Asaas (decisão do dono: boleto + cartão, sem Pix, taxa
-- do meio repassada ao cliente). O webhook grava `metodo='boleto_asaas'` e o valor LÍQUIDO da taxa
-- (a taxa viaja no externalReference `honorario|<id>|taxa:<valor>` — api/asaas-webhook.js).
alter table public.honorarios_recebimentos drop constraint if exists honorarios_recebimentos_metodo_check;
alter table public.honorarios_recebimentos add constraint honorarios_recebimentos_metodo_check
  check (metodo = any (array['pix_externo','pix_mp','pix_asaas','cheque','cartao_mp','cartao_asaas','boleto_asaas','dinheiro','transferencia']));
