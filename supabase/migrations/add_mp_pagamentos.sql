-- ─── Mercado Pago — Pagamentos, Assinaturas e Saques ──────────────────────────

-- Pagamentos avulsos (Checkout Pro)
CREATE TABLE IF NOT EXISTS mp_pagamentos (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mp_payment_id    text NOT NULL UNIQUE,
  user_id          uuid REFERENCES auth.users,
  plano_key        text,
  valor            numeric(14,2),
  status           text,        -- pending | approved | rejected | cancelled
  status_detalhe   text,
  metodo           text,        -- credit_card | debit_card | pix | ticket
  external_ref     text,
  dados_mp         jsonb,
  atualizado_em    timestamptz DEFAULT now(),
  criado_em        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_pagamentos_user   ON mp_pagamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_pagamentos_status ON mp_pagamentos(status);

-- Assinaturas recorrentes (Preapproval)
CREATE TABLE IF NOT EXISTS mp_assinaturas (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mp_assinatura_id   text NOT NULL UNIQUE,
  user_id            uuid REFERENCES auth.users,
  plano_key          text,
  status             text,      -- pending | authorized | paused | cancelled
  dados_mp           jsonb,
  atualizado_em      timestamptz DEFAULT now(),
  criado_em          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_assinaturas_user ON mp_assinaturas(user_id);

-- Solicitações de saque de comissão (consultores, analistas, advogados)
CREATE TABLE IF NOT EXISTS mp_saques (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid REFERENCES auth.users NOT NULL,
  nome_solicitante   text,
  email_solicitante  text,
  role               text,                    -- consultor | analista | advogado
  valor              numeric(14,2) NOT NULL,
  chave_pix          text,
  banco              text,
  agencia            text,
  conta              text,
  tipo_conta         text DEFAULT 'corrente', -- corrente | poupanca
  observacao         text,
  status             text NOT NULL DEFAULT 'pendente',
  -- pendente | pago | rejeitado
  aprovado_por       uuid,
  aprovado_em        timestamptz,
  comprovante_url    text,
  observacao_admin   text,
  solicitado_em      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_saques_user   ON mp_saques(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_saques_status ON mp_saques(status);

-- RLS
ALTER TABLE mp_pagamentos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_saques      ENABLE ROW LEVEL SECURITY;

-- Usuário vê os próprios; admin vê tudo
CREATE POLICY "mp_pagamentos_owner_admin" ON mp_pagamentos FOR ALL TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "mp_assinaturas_owner_admin" ON mp_assinaturas FOR ALL TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "mp_saques_owner_admin" ON mp_saques FOR ALL TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'));
