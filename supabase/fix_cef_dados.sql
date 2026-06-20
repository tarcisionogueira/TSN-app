-- Corrige dados existentes da CEF que vieram sem forma_pagamento e com tipo genérico

-- 1. Todos imóveis da CEF são À Vista
UPDATE public.imoveis_leilao
SET forma_pagamento = 'a_vista'
WHERE fonte = 'caixa' AND (forma_pagamento IS NULL OR forma_pagamento = '');

-- 2. Inferir tipo a partir da descrição/título para imóveis com tipo='imovel'
UPDATE public.imoveis_leilao SET tipo = 'apartamento'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%apartamento%' OR lower(titulo) LIKE '%apartamento%' OR lower(descricao) LIKE '%apto%');

UPDATE public.imoveis_leilao SET tipo = 'casa'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%casa%' OR lower(titulo) LIKE '%casa%');

UPDATE public.imoveis_leilao SET tipo = 'terreno'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%terreno%' OR lower(descricao) LIKE '%lote%' OR lower(titulo) LIKE '%terreno%');

UPDATE public.imoveis_leilao SET tipo = 'sala'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%sala%' OR lower(descricao) LIKE '%loja%' OR lower(descricao) LIKE '%conjunto%');

UPDATE public.imoveis_leilao SET tipo = 'galpao'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%galp%' OR lower(descricao) LIKE '%armazem%' OR lower(descricao) LIKE '%armazém%');

UPDATE public.imoveis_leilao SET tipo = 'rural'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%rural%' OR lower(descricao) LIKE '%sitio%' OR lower(descricao) LIKE '%sítio%' OR lower(descricao) LIKE '%fazenda%' OR lower(descricao) LIKE '%chacara%');

UPDATE public.imoveis_leilao SET tipo = 'comercial'
WHERE tipo = 'imovel' AND (lower(descricao) LIKE '%comercial%' OR lower(descricao) LIKE '%prédio%' OR lower(descricao) LIKE '%predio%');

-- 3. Normalizar modalidade da CEF
UPDATE public.imoveis_leilao SET modalidade = 'primeiro_leilao'
WHERE fonte = 'caixa' AND (modalidade LIKE '%1%praça%' OR modalidade LIKE '%1%leil%' OR modalidade LIKE '%primeiro%' OR modalidade = '1ª praça' OR modalidade = '1a praca');

UPDATE public.imoveis_leilao SET modalidade = 'segundo_leilao'
WHERE fonte = 'caixa' AND (modalidade LIKE '%2%praça%' OR modalidade LIKE '%2%leil%' OR modalidade LIKE '%segundo%' OR modalidade = '2ª praça' OR modalidade = '2a praca');

UPDATE public.imoveis_leilao SET modalidade = 'venda_direta'
WHERE fonte = 'caixa' AND (modalidade LIKE '%venda%direta%' OR modalidade LIKE '%venda direta%');

UPDATE public.imoveis_leilao SET modalidade = 'licitacao_aberta'
WHERE fonte = 'caixa' AND (modalidade LIKE '%licita%');
