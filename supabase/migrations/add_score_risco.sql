-- Adiciona colunas de score de risco duplo na tabela imoveis_leilao
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS score_financeiro smallint DEFAULT NULL CHECK (score_financeiro BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_juridico   smallint DEFAULT NULL CHECK (score_juridico BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_calculado_em timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.imoveis_leilao.score_financeiro IS 'Score 0-100: avalia desconto, modalidade, tipo. 100 = máxima oportunidade, 0 = máximo risco.';
COMMENT ON COLUMN public.imoveis_leilao.score_juridico IS 'Score 0-100: aprendido a partir dos laudos jurídicos submetidos para imóveis similares. NULL = sem histórico.';

-- Tabela de sanções federais (alimentada pelo scraper-transparencia.js)
-- Fontes: CEIS e CNEP do Portal da Transparência
CREATE TABLE IF NOT EXISTS public.sancoes_federais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte         text NOT NULL,         -- 'ceis' | 'cnep'
  fonte_id      text NOT NULL,         -- identificador único na fonte
  cpf_cnpj      text,                  -- CPF ou CNPJ sancionado
  nome_sancionado text,
  tipo_sancao   text,
  orgao_sancionador text,
  data_inicio_sancao date,
  data_fim_sancao    date,
  fundamentacao_legal text,
  processo      text,
  ativo         boolean DEFAULT true,
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (fonte, fonte_id)
);

COMMENT ON TABLE public.sancoes_federais IS 'Registros do CEIS e CNEP (Portal da Transparência) — usados para enriquecer o score_juridico.';

-- Índices para busca rápida por CPF/CNPJ (usado ao calcular score jurídico)
CREATE INDEX IF NOT EXISTS idx_sancoes_federais_cpf_cnpj ON public.sancoes_federais (cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_sancoes_federais_fonte     ON public.sancoes_federais (fonte);
