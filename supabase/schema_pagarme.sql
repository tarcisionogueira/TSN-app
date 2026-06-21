-- Suporte ao Pagar.me: coluna para armazenar o ID do cliente no gateway
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS pagarme_id text;

CREATE INDEX IF NOT EXISTS idx_perfis_pagarme_id ON public.perfis(pagarme_id)
  WHERE pagarme_id IS NOT NULL;
