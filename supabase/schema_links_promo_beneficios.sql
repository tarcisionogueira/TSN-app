-- Adiciona coluna beneficios à tabela links_promo
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS beneficios text;
