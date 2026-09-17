-- Asaas vira fallback automático de honorário/cobrança avulsa (18/09) — precisa de um
-- `metodo` próprio pra não rotular pagamento do Asaas como "cartao_mp"/"pix_mp" (rótulo
-- errado desde a origem, confunde reconciliação e suporte). Aditivo: só amplia o CHECK,
-- nenhuma linha existente muda.
alter table public.honorarios_recebimentos drop constraint honorarios_recebimentos_metodo_check;
alter table public.honorarios_recebimentos add constraint honorarios_recebimentos_metodo_check
  check (metodo = any (array['pix_externo','pix_mp','pix_asaas','cheque','cartao_mp','cartao_asaas','dinheiro','transferencia']));
