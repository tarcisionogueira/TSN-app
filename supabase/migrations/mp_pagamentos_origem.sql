-- Financeiro: classifica cada pagamento espelhado como MENSALIDADE (recorrente) ou VENDA
-- avulsa, para separar "real recebido" por tipo. Recorrente vem de assinatura (preapproval);
-- avulso vem de Checkout Pro (serviços, produtos, compras pontuais).
alter table public.mp_pagamentos add column if not exists origem text not null default 'avulso'; -- 'recorrente' | 'avulso'
create index if not exists idx_mp_pagamentos_origem on public.mp_pagamentos(origem);
create index if not exists idx_mp_pagamentos_criado on public.mp_pagamentos(criado_em);
create index if not exists idx_mp_assinaturas_status on public.mp_assinaturas(status);
