-- ═══════════════════════════════════════════════════════════════
-- FIX v3 — Corrige nomes, remove top1 duplicado, ajusta preços
-- ═══════════════════════════════════════════════════════════════

-- 1. Remove "Plano Pago" (top1) — duplicado incorreto
DELETE FROM public.planos_config WHERE plano_key = 'top1';

-- 2. Renomeia top2 → Investidor Pro com preço correto
UPDATE public.planos_config
SET nome       = 'Investidor Pro',
    preco      = 49.90,
    preco_anual = 449.90,
    assinatura  = true,
    ativo       = true
WHERE plano_key = 'top2';

-- 3. Corrige assessorado: valor mensal R$500, total R$6.000, à vista R$5.000 (desconto ~16,67%)
UPDATE public.planos_config
SET nome              = 'Assessoria',
    preco             = 6000.00,
    preco_vista       = 5000.00,
    desconto_vista_pct = 16.67,
    assinatura        = false,
    ativo             = true
WHERE plano_key = 'assessorado';

-- 4. Corrige clube: total R$60.000, à vista R$48.000 (desconto 20%)
UPDATE public.planos_config
SET nome              = 'Leilão Club',
    preco             = 60000.00,
    preco_vista       = 48000.00,
    desconto_vista_pct = 20,
    assinatura        = false,
    ativo             = true
WHERE plano_key = 'clube';

-- 5. Explorador gratuito
UPDATE public.planos_config
SET nome = 'Explorador', preco = 0, ativo = true
WHERE plano_key = 'explorador';
