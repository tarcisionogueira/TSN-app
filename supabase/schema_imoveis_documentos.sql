-- Colunas para identificação de matrícula, edital e processo por imóvel
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS numero_edital    text,
  ADD COLUMN IF NOT EXISTS numero_matricula text,
  ADD COLUMN IF NOT EXISTS numero_processo  text;

CREATE INDEX IF NOT EXISTS idx_imoveis_edital    ON public.imoveis_leilao(numero_edital)    WHERE numero_edital IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imoveis_matricula ON public.imoveis_leilao(numero_matricula)  WHERE numero_matricula IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imoveis_processo  ON public.imoveis_leilao(numero_processo)   WHERE numero_processo IS NOT NULL;
