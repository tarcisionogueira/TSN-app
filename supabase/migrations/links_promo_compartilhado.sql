-- Promoções criadas pelo admin ficam DISPONÍVEIS para consultores e afiliados
-- comercializarem (cada um compartilha com o seu ?ref= para atribuir a comissão).
-- compartilhado=true → aparece no "Material de Divulgação" de todos os parceiros.
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS compartilhado boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_links_promo_compartilhado ON public.links_promo(compartilhado) WHERE compartilhado = true;
