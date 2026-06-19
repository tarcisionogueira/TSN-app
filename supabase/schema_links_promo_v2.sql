-- Adiciona campo de validade em dias para links promocionais
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS validade_dias integer;
