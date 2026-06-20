-- Correção dos dados CEF existentes — v2 (sem unaccent)
-- Execute no SQL Editor do Supabase

-- 1. Imóveis de venda direta da CEF são financiáveis
UPDATE public.imoveis_leilao
SET forma_pagamento = 'financiado'
WHERE fonte = 'caixa' AND modalidade = 'venda_direta';

-- 2. Todos os outros imóveis da CEF sem pagamento definido são À Vista
UPDATE public.imoveis_leilao
SET forma_pagamento = 'a_vista'
WHERE fonte = 'caixa' AND (forma_pagamento IS NULL OR forma_pagamento = '') AND (modalidade IS NULL OR modalidade != 'venda_direta');

-- 3. Tipo comercial (sem unaccent)
UPDATE public.imoveis_leilao SET tipo = 'comercial'
WHERE tipo IN ('imovel', 'comercial') AND (
  lower(coalesce(descricao,'')) LIKE '%comercial%' OR
  lower(coalesce(descricao,'')) LIKE '%comercio%' OR
  lower(coalesce(descricao,'')) LIKE '%ponto com%' OR
  lower(coalesce(descricao,'')) LIKE '%predio%' OR
  lower(coalesce(descricao,'')) LIKE '%pr%dio%' OR
  lower(coalesce(descricao,'')) LIKE '%pavilh%' OR
  lower(coalesce(titulo,'')) LIKE '%comercial%'
);

-- 4. Sala/loja
UPDATE public.imoveis_leilao SET tipo = 'sala'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%sala%' OR
  lower(coalesce(descricao,'')) LIKE '%loja%' OR
  lower(coalesce(descricao,'')) LIKE '%conjunto%' OR
  lower(coalesce(descricao,'')) LIKE '%escritorio%' OR
  lower(coalesce(descricao,'')) LIKE '%escrit%rio%' OR
  lower(coalesce(descricao,'')) LIKE '%box %'
);

-- 5. Apartamento
UPDATE public.imoveis_leilao SET tipo = 'apartamento'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%apartamento%' OR
  lower(coalesce(descricao,'')) LIKE '%apto%'
);

-- 6. Casa
UPDATE public.imoveis_leilao SET tipo = 'casa'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%casa%' OR
  lower(coalesce(descricao,'')) LIKE '%sobrado%'
);

-- 7. Terreno
UPDATE public.imoveis_leilao SET tipo = 'terreno'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%terreno%' OR
  lower(coalesce(descricao,'')) LIKE '%lote%' OR
  lower(coalesce(descricao,'')) LIKE '%gleba%'
);

-- 8. Galpão
UPDATE public.imoveis_leilao SET tipo = 'galpao'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%galp%' OR
  lower(coalesce(descricao,'')) LIKE '%armazem%' OR
  lower(coalesce(descricao,'')) LIKE '%arm%zem%' OR
  lower(coalesce(descricao,'')) LIKE '%deposito%'
);

-- 9. Rural
UPDATE public.imoveis_leilao SET tipo = 'rural'
WHERE tipo = 'imovel' AND (
  lower(coalesce(descricao,'')) LIKE '%rural%' OR
  lower(coalesce(descricao,'')) LIKE '%sitio%' OR
  lower(coalesce(descricao,'')) LIKE '%s%tio%' OR
  lower(coalesce(descricao,'')) LIKE '%fazenda%' OR
  lower(coalesce(descricao,'')) LIKE '%chacara%' OR
  lower(coalesce(descricao,'')) LIKE '%ch%cara%'
);
