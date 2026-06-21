-- Adiciona percentual de comissão por plano
ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS comissao_pct numeric NOT NULL DEFAULT 0;

-- Valores padrão por plano
UPDATE public.planos_config SET comissao_pct = 10 WHERE plano_key IN ('top1','top2','assessorado','clube');
UPDATE public.planos_config SET comissao_pct = 0  WHERE plano_key IN ('analista','advogado','consultor');
