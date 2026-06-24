-- Leiloeiros: campos extras no perfil
ALTER TABLE perfis
  ADD COLUMN IF NOT EXISTS leiloeiro_webhook_key text,
  ADD COLUMN IF NOT EXISTS matricula text,
  ADD COLUMN IF NOT EXISTS junta text,
  ADD COLUMN IF NOT EXISTS site text;

-- Tabela de lotes enviados via webhook
CREATE TABLE IF NOT EXISTS imoveis_leiloeiro (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leiloeiro_id     uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  id_externo       text NOT NULL,
  titulo           text,
  tipo             text,
  endereco         text,
  cidade           text,
  estado           text,
  valor_avaliacao  numeric,
  valor_minimo     numeric,
  area_m2          numeric,
  data_leilao      timestamptz,
  modalidade       text,
  url_lote         text,
  descricao        text,
  status           text DEFAULT 'ativo',    -- ativo | encerrado | cancelado
  dados_raw        jsonb,
  criado_em        timestamptz DEFAULT now(),
  atualizado_em    timestamptz DEFAULT now(),
  UNIQUE (leiloeiro_id, id_externo)
);

-- RLS: leiloeiro vê apenas seus lotes; admin vê todos
ALTER TABLE imoveis_leiloeiro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leiloeiro_own" ON imoveis_leiloeiro
  FOR ALL USING (leiloeiro_id = auth.uid());

CREATE POLICY "admin_all_leiloeiro" ON imoveis_leiloeiro
  FOR ALL USING (
    EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin')
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_imoveis_leiloeiro_id   ON imoveis_leiloeiro(leiloeiro_id);
CREATE INDEX IF NOT EXISTS idx_imoveis_leiloeiro_ext  ON imoveis_leiloeiro(id_externo);
CREATE INDEX IF NOT EXISTS idx_imoveis_leiloeiro_data ON imoveis_leiloeiro(data_leilao);
CREATE INDEX IF NOT EXISTS idx_imoveis_leiloeiro_uf   ON imoveis_leiloeiro(estado);
