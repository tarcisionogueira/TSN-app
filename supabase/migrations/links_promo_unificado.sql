-- Unificação Promoções + SDR (passo 2): o link promocional passa a apontar para
-- PLANO, CURSO ou EBOOK, com validade do DESCONTO separada da validade do LINK, e
-- um gate opcional de perguntas (se exigido, a pessoa só acessa após responder).
ALTER TABLE public.links_promo
  ADD COLUMN IF NOT EXISTS produto_tipo           text DEFAULT 'plano', -- 'plano' | 'curso' | 'ebook'
  ADD COLUMN IF NOT EXISTS produto_ref_id         uuid,                 -- id do curso/ebook (null p/ plano)
  ADD COLUMN IF NOT EXISTS desconto_validade_ate  timestamptz,          -- validade do DESCONTO (pode diferir da do link)
  ADD COLUMN IF NOT EXISTS exige_perguntas        boolean NOT NULL DEFAULT false; -- perguntas obrigatórias p/ acessar
