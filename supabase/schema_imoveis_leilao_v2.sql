-- Adiciona colunas necessárias para os scrapers (idempotente)
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS area_m2            numeric,
  ADD COLUMN IF NOT EXISTS forma_pagamento    text,
  ADD COLUMN IF NOT EXISTS url_lote           text,
  ADD COLUMN IF NOT EXISTS data_leilao        timestamptz,
  ADD COLUMN IF NOT EXISTS viavel             boolean,
  ADD COLUMN IF NOT EXISTS score_viabilidade  integer,
  ADD COLUMN IF NOT EXISTS motivo_viabilidade text,
  ADD COLUMN IF NOT EXISTS fracionado         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nomeCondominio     text,
  ADD COLUMN IF NOT EXISTS link_foto          text;

-- Índices úteis para filtros na busca
CREATE INDEX IF NOT EXISTS idx_imoveis_viavel   ON public.imoveis_leilao(viavel);
CREATE INDEX IF NOT EXISTS idx_imoveis_data     ON public.imoveis_leilao(data_leilao);
CREATE INDEX IF NOT EXISTS idx_imoveis_tipo     ON public.imoveis_leilao(tipo);
