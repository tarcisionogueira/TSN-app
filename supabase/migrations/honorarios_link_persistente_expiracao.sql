-- 16/09: o link de honorários (criarPreferenciaHonorario, api/mp.js) precisa (a) continuar
-- disponível/copiável depois de gerado uma vez (sem regravar preferência nova a cada clique)
-- e (b) ter prazo — pedido do dono, até 2 dias. Guardamos o próprio link (não só o id da
-- preferência) e quando ele expira, para reusar enquanto válido e regenerar só depois.
alter table public.arrematacoes
  add column if not exists honorarios_link_pagamento text,
  add column if not exists honorarios_link_expira_em timestamptz;
