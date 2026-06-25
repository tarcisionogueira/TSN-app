-- Mercado Pago como gateway principal
-- Execute no SQL Editor do Supabase

-- 1. Campo mp_id no perfil (equivalente ao asaas_id, pagarme_id)
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS mp_id text;

CREATE INDEX IF NOT EXISTS idx_perfis_mp_id ON public.perfis(mp_id) WHERE mp_id IS NOT NULL;

-- 2. Campos de antecipação e gateway nos saques
ALTER TABLE public.mp_saques
  ADD COLUMN IF NOT EXISTS antecipado boolean DEFAULT false;

-- 3. gateway_payment_id na tabela de comissões (substitui asaas_payment_id para suportar MP)
ALTER TABLE public.comissoes
  ADD COLUMN IF NOT EXISTS gateway_payment_id text,
  ADD COLUMN IF NOT EXISTS gateway text DEFAULT 'mercadopago';

-- Migra dados existentes (asaas_payment_id → gateway_payment_id)
UPDATE public.comissoes
  SET gateway_payment_id = asaas_payment_id,
      gateway = 'asaas'
  WHERE asaas_payment_id IS NOT NULL
    AND gateway_payment_id IS NULL;

-- Índice de dedup para comissões (evita duplicatas por gateway_payment_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_comissoes_gateway_payment
  ON public.comissoes(gateway_payment_id, origem)
  WHERE gateway_payment_id IS NOT NULL;
