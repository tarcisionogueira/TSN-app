-- Adiciona percentual de comissão em ebooks
ALTER TABLE public.ebooks_admin
  ADD COLUMN IF NOT EXISTS comissao_pct numeric NOT NULL DEFAULT 0;
