-- LANÇAMENTOS ganham comprovante vinculável (18/09, pedido do dono: "não tem um campo aqui de
-- comprovante para vincular aos pagamentos"). anexo_id aponta para o PDF já guardado em
-- imovel_anexos (tipo comprovante_pagamento) — o mesmo bucket/retenção permanente dos demais
-- documentos de arremate, só que agora rastreável por LANÇAMENTO, não só por imóvel.
alter table public.arrematado_lancamentos
  add column if not exists anexo_id uuid references public.imovel_anexos(id) on delete set null;

comment on column public.arrematado_lancamentos.anexo_id is
  'Comprovante de pagamento vinculado a este lançamento (imovel_anexos.tipo = comprovante_pagamento). Nulo = sem comprovante anexado.';
