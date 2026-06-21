-- Adiciona campo de desconto à vista por plano
ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS desconto_vista_pct numeric NOT NULL DEFAULT 0;

-- Corrige preços e configura descontos conforme definição comercial
UPDATE public.planos_config SET
  nome = 'Explorador', preco = 0, cobrar = false
  WHERE plano_key = 'explorador';

UPDATE public.planos_config SET
  nome = 'Investidor Pro', preco = 49.90, preco_anual = 449.90, desconto_vista_pct = 0
  WHERE plano_key = 'top1';

UPDATE public.planos_config SET
  nome = 'Assessoria', preco = 500.00, preco_vista = 5000.00, desconto_vista_pct = 16.67
  WHERE plano_key = 'assessorado';

UPDATE public.planos_config SET
  nome = 'Leilão Club', preco = 5000.00, preco_vista = 48000.00, desconto_vista_pct = 20
  WHERE plano_key = 'clube';
