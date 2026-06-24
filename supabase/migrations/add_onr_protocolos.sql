-- ─── ONR Digital — Protocolos de Registro de Imóveis ─────────────────────────

CREATE TABLE IF NOT EXISTS onr_protocolos (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  imovel_id               uuid,   -- pode ser null se protocolo avulso
  user_id                 uuid REFERENCES auth.users NOT NULL,
  numero_protocolo        text NOT NULL,
  data_protocolo          date,
  cartorio_nome           text,
  cartorio_cidade         text NOT NULL,
  cartorio_uf             text NOT NULL,
  valor_arrematacao       numeric(14,2),
  matricula               text,
  nome_arrematante        text,
  cpf_cnpj_arrematante    text,
  docs_enviados           jsonb DEFAULT '[]',  -- [{ key, nome, url }]
  status                  text NOT NULL DEFAULT 'protocolado',
  -- protocolado | em_analise | exigencias | registrado | cancelado
  notas                   text,
  atualizado_em           timestamptz,
  criado_em               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onr_protocolos_imovel ON onr_protocolos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_onr_protocolos_user   ON onr_protocolos(user_id);

ALTER TABLE onr_protocolos ENABLE ROW LEVEL SECURITY;

-- Usuário vê/escreve os próprios; admin vê tudo
CREATE POLICY "onr_owner_or_admin" ON onr_protocolos
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin')
  );
