-- Imóveis de leilão importados de fontes externas (Caixa, Santander, etc.)
CREATE TABLE IF NOT EXISTS public.imoveis_leilao (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte            text        NOT NULL,
  fonte_id         text        NOT NULL,
  estado           text,
  cidade           text,
  bairro           text,
  endereco         text,
  titulo           text,
  tipo             text,
  valor_avaliacao  numeric,
  valor_minimo     numeric,
  desconto_percentual integer,
  modalidade       text,
  leiloeiro        text,
  link_edital      text,
  link_foto        text,
  descricao        text,
  ativo            boolean     NOT NULL DEFAULT true,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fonte, fonte_id)
);

CREATE INDEX IF NOT EXISTS idx_imoveis_leilao_estado   ON public.imoveis_leilao(estado);
CREATE INDEX IF NOT EXISTS idx_imoveis_leilao_cidade   ON public.imoveis_leilao(cidade);
CREATE INDEX IF NOT EXISTS idx_imoveis_leilao_fonte    ON public.imoveis_leilao(fonte);
CREATE INDEX IF NOT EXISTS idx_imoveis_leilao_desconto ON public.imoveis_leilao(desconto_percentual DESC);

ALTER TABLE public.imoveis_leilao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública imoveis_leilao"
  ON public.imoveis_leilao FOR SELECT USING (true);
