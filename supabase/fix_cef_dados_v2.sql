-- Correção dos dados CEF existentes — v2
-- Execute no SQL Editor do Supabase

-- 1. Imóveis de venda direta da CEF são financiáveis
UPDATE public.imoveis_leilao
SET forma_pagamento = 'financiado'
WHERE fonte = 'caixa' AND modalidade = 'venda_direta';

-- 2. Todos os outros imóveis da CEF são À Vista
UPDATE public.imoveis_leilao
SET forma_pagamento = 'a_vista'
WHERE fonte = 'caixa' AND (forma_pagamento IS NULL OR forma_pagamento = '') AND modalidade != 'venda_direta';

-- 3. Tipos comerciais — expandido com mais palavras-chave
UPDATE public.imoveis_leilao SET tipo = 'comercial'
WHERE tipo IN ('imovel','comercial') AND (
  lower(unaccent(descricao)) LIKE '%comercial%' OR
  lower(unaccent(descricao)) LIKE '%comercio%' OR
  lower(unaccent(descricao)) LIKE '%ponto com%' OR
  lower(unaccent(descricao)) LIKE '%predio%' OR
  lower(unaccent(descricao)) LIKE '%pavilh%' OR
  lower(unaccent(titulo)) LIKE '%comercial%'
);

-- 4. Sala comercial (antes de comercial para não sobrescrever)
UPDATE public.imoveis_leilao SET tipo = 'sala'
WHERE tipo = 'imovel' AND (
  lower(unaccent(descricao)) LIKE '%sala%' OR
  lower(unaccent(descricao)) LIKE '%loja%' OR
  lower(unaccent(descricao)) LIKE '%conjunto%' OR
  lower(unaccent(descricao)) LIKE '%escritorio%' OR
  lower(unaccent(descricao)) LIKE '%box %'
);

-- 5. Demais tipos
UPDATE public.imoveis_leilao SET tipo = 'apartamento'
WHERE tipo = 'imovel' AND (lower(unaccent(descricao)) LIKE '%apartamento%' OR lower(unaccent(descricao)) LIKE '%apto%');

UPDATE public.imoveis_leilao SET tipo = 'casa'
WHERE tipo = 'imovel' AND (lower(unaccent(descricao)) LIKE '%casa%' OR lower(unaccent(descricao)) LIKE '%sobrado%');

UPDATE public.imoveis_leilao SET tipo = 'terreno'
WHERE tipo = 'imovel' AND (lower(unaccent(descricao)) LIKE '%terreno%' OR lower(unaccent(descricao)) LIKE '%lote%' OR lower(unaccent(descricao)) LIKE '%gleba%');

UPDATE public.imoveis_leilao SET tipo = 'galpao'
WHERE tipo = 'imovel' AND (lower(unaccent(descricao)) LIKE '%galp%' OR lower(unaccent(descricao)) LIKE '%armazem%' OR lower(unaccent(descricao)) LIKE '%deposito%');

UPDATE public.imoveis_leilao SET tipo = 'rural'
WHERE tipo = 'imovel' AND (lower(unaccent(descricao)) LIKE '%rural%' OR lower(unaccent(descricao)) LIKE '%sitio%' OR lower(unaccent(descricao)) LIKE '%fazenda%' OR lower(unaccent(descricao)) LIKE '%chacara%');
