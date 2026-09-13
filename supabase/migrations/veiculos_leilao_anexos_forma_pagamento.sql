-- ═══════════════════════════════════════════════════════════════════════════════
-- veiculos_leilao ganha anexos/forma_pagamento (13/09, pedido do dono)
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE: os scrapers de veículo (Sodré, Suporte, Superbid, Mega, WebLeilões) já
-- coletam descrição e fotos, mas não tinham onde gravar anexos (PDFs de edital/laudo
-- quando existem) nem a forma de pagamento — a tabela simplesmente não tinha essas
-- colunas. Espelha as mesmas colunas que `imoveis_leilao` já usa (`anexos` jsonb,
-- `forma_pagamento` text), pelo mesmo motivo.
alter table public.veiculos_leilao
  add column if not exists anexos jsonb,
  add column if not exists forma_pagamento text;

comment on column public.veiculos_leilao.anexos is 'PDFs do lote (edital/laudo/matrícula quando existir), achados na página de detalhe ou no payload da API — [{nome, url, tipo}]. Null quando nenhum foi encontrado.';
comment on column public.veiculos_leilao.forma_pagamento is 'Mesma convenção de imoveis_leilao.forma_pagamento — hoje sempre "a_vista" nos pilotos de veículo (nenhuma fonte expõe parcelamento estruturado ainda).';
