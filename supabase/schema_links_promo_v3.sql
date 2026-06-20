-- Adiciona campos de promoção pública e validade por data
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS publico      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validade_ate timestamptz;

CREATE INDEX IF NOT EXISTS idx_links_promo_publico ON public.links_promo(publico) WHERE publico = true;
