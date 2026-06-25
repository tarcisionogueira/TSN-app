-- Adiciona coluna CEP extraído do campo endereco (CSV Caixa e leiloeiros)
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS cep varchar(8);

CREATE INDEX IF NOT EXISTS idx_imoveis_cep ON public.imoveis_leilao(cep)
  WHERE cep IS NOT NULL;
