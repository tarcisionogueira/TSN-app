-- Passos do tour guiado gerenciados pelo admin
CREATE TABLE IF NOT EXISTS tour_steps (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem     integer     NOT NULL DEFAULT 0,
  titulo    text        NOT NULL,
  descricao text,
  selector  text,
  ativo     boolean     NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tour_steps ENABLE ROW LEVEL SECURITY;

-- Leitura pública (todos os usuários autenticados podem ver os passos ativos)
CREATE POLICY "tour_steps_select" ON tour_steps
  FOR SELECT USING (true);

-- Escrita apenas para admin (via service key nas funções serverless)
