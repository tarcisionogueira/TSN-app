-- Corrige planos: remove top1 duplicado e renomeia top2 -> Investidor Pro
-- "Plano Pago" (top1) está com preço R$49,90 mas o plano correto é top2
-- Remove top1 (linha com X na tela) e transforma top2 em Investidor Pro

DELETE FROM public.planos_config WHERE plano_key = 'top1';

UPDATE public.planos_config
SET nome = 'Investidor Pro',
    preco = 49.90,
    preco_anual = 449.90,
    assinatura = true
WHERE plano_key = 'top2';

-- Garante que Consultor/Afiliado mantenha o nome correto
UPDATE public.planos_config SET nome = 'Consultor/Afiliado' WHERE plano_key = 'consultor';

-- Clube de Negócios -> Leilão Club conforme nome comercial
UPDATE public.planos_config SET nome = 'Leilão Club', preco = 5000.00 WHERE plano_key = 'clube';
