-- Corrige nomes e preços dos planos conforme definição comercial
UPDATE public.planos_config SET nome = 'Explorador'    WHERE plano_key = 'explorador';
UPDATE public.planos_config SET nome = 'Investidor Pro', preco = 49.90, preco_anual = 449.00 WHERE plano_key = 'top1';
UPDATE public.planos_config SET nome = 'Assessoria',   preco = 500.00, preco_vista = 5000.00 WHERE plano_key = 'assessorado';
UPDATE public.planos_config SET nome = 'Leilão Club',  preco = 5000.00, preco_vista = 48000.00 WHERE plano_key = 'clube';
