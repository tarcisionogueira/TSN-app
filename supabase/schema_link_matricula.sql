-- Adiciona coluna de URL direta para o PDF da matrícula
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS link_matricula text;
