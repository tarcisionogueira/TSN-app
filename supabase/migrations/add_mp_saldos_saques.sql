-- ============================================================
-- Saldos dos profissionais (TSN retém na conta MP e paga sob demanda)
-- ============================================================
CREATE TABLE IF NOT EXISTS saldos_profissionais (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saldo_disponivel NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (saldo_disponivel >= 0),
  saldo_retido     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (saldo_retido >= 0),
  total_recebido   NUMERIC(10,2) NOT NULL DEFAULT 0,
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saldos_user ON saldos_profissionais(user_id);

ALTER TABLE saldos_profissionais ENABLE ROW LEVEL SECURITY;

-- Profissional vê só o próprio saldo; admin vê todos (via service_role)
CREATE POLICY "saldo_proprio" ON saldos_profissionais
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- Solicitações de saque
-- ============================================================
CREATE TABLE IF NOT EXISTS saques (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  valor           NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  chave_pix       TEXT NOT NULL,
  banco_nome      TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','rejeitado')),
  aprovado_por    UUID REFERENCES auth.users(id),
  mp_payment_id   TEXT,
  processado_em   TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saques_user   ON saques(user_id);
CREATE INDEX IF NOT EXISTS idx_saques_status ON saques(status);

ALTER TABLE saques ENABLE ROW LEVEL SECURITY;

-- Profissional vê os próprios saques
CREATE POLICY "saques_proprios" ON saques
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- Controle Bacen: volume mensal recebido via MP
-- Para exibir alerta no dashboard quando se aproximar de R$ 500k/mês
-- ============================================================
CREATE TABLE IF NOT EXISTS mp_volume_mensal (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mes       TEXT NOT NULL UNIQUE,  -- formato: '2026-06'
  total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mp_volume_mensal ENABLE ROW LEVEL SECURITY;
-- Apenas service_role acessa
