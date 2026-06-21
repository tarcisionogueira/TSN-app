-- Atualiza nomes dos planos na tabela de configuração
UPDATE public.planos_config SET nome = 'Plano Pago'     WHERE plano_key = 'top1';
UPDATE public.planos_config SET nome = 'Plano Pago Pro' WHERE plano_key = 'top2';
UPDATE public.planos_config SET nome = 'Assessoria'     WHERE plano_key = 'assessorado';
