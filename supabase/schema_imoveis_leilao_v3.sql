-- ================================================================
-- imoveis_leilao v3 — colunas obrigatórias para o scraper funcionar
-- ================================================================

ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS desconto_percentual integer;

-- Constraint UNIQUE necessária para o upsert onConflict funcionar
DO $$ BEGIN
  ALTER TABLE public.imoveis_leilao
    ADD CONSTRAINT uq_imoveis_fonte UNIQUE (fonte, fonte_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
  NULL; -- já existe, tudo bem
END $$;

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_imoveis_ativo ON public.imoveis_leilao(ativo);
CREATE INDEX IF NOT EXISTS idx_imoveis_atualizado ON public.imoveis_leilao(atualizado_em);
CREATE INDEX IF NOT EXISTS idx_imoveis_desconto ON public.imoveis_leilao(desconto_percentual);
