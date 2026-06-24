-- ─── Fidelidade, cancelamento e assinaturas premium ──────────────────────────
-- Rodar no Supabase SQL Editor

-- 1. Novas colunas em planos_config
ALTER TABLE planos_config
  ADD COLUMN IF NOT EXISTS fidelidade_meses     int,
  ADD COLUMN IF NOT EXISTS multa_cancelamento_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pagamento_tipo        text DEFAULT 'recorrente',
  -- 'recorrente' | 'unico' | 'parcelado_fixo'
  ADD COLUMN IF NOT EXISTS acesso_meses          int,
  ADD COLUMN IF NOT EXISTS vinculado_arrematacao boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS honorarios_exito_pct  numeric(5,2) DEFAULT 0;

-- 2. Valores padrão para assessorado e clube
UPDATE planos_config SET
  fidelidade_meses        = 12,
  multa_cancelamento_pct  = 0,          -- pagamento único: sem multa de cancelamento (acesso expira)
  pagamento_tipo          = 'parcelado_fixo', -- 12× ou à vista
  acesso_meses            = 12,
  vinculado_arrematacao   = true,
  honorarios_exito_pct    = 10
WHERE plano_key = 'assessorado';

UPDATE planos_config SET
  fidelidade_meses        = 12,
  multa_cancelamento_pct  = 30,         -- 30% do saldo restante da fidelidade
  pagamento_tipo          = 'recorrente',
  acesso_meses            = NULL,       -- acesso contínuo (renovação após fidelidade)
  vinculado_arrematacao   = false,
  honorarios_exito_pct    = 10
WHERE plano_key = 'clube';

-- 3. Tabela de assinaturas premium (assessorado e clube)
CREATE TABLE IF NOT EXISTS plano_assinaturas (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users NOT NULL,
  plano_key           text NOT NULL,
  status              text NOT NULL DEFAULT 'ativo', -- ativo | cancelado | concluido | inadimplente
  inicio              timestamptz NOT NULL DEFAULT now(),
  fidelidade_fim      timestamptz,   -- fim do período de fidelidade (clube: inicio + 12 meses)
  acesso_fim          timestamptz,   -- fim do acesso (assessorado: inicio + 12 meses, extensível)
  imovel_id           uuid,          -- assessorado: imóvel vinculado
  valor_mensal        numeric(12,2), -- valor da parcela mensal ao contratar
  forma_pagamento     text DEFAULT 'parcelado', -- parcelado | a_vista | recorrente
  valor_total_pago    numeric(12,2),
  multa_calculada     numeric(12,2), -- calculada no momento do cancelamento
  multa_aplicada      numeric(12,2),
  cancelado_em        timestamptz,
  cancelado_por       uuid,          -- user_id do admin
  notas_admin         text,
  extended_by         uuid,          -- admin que estendeu o prazo
  extended_at         timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plano_assinaturas_user  ON plano_assinaturas(user_id);
CREATE INDEX IF NOT EXISTS idx_plano_assinaturas_plano ON plano_assinaturas(plano_key);
CREATE INDEX IF NOT EXISTS idx_plano_assinaturas_status ON plano_assinaturas(status);

ALTER TABLE plano_assinaturas ENABLE ROW LEVEL SECURITY;

-- Admin lê/escreve tudo; usuário lê somente as próprias
CREATE POLICY "admin_all_assinaturas" ON plano_assinaturas
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin')
    OR user_id = auth.uid()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Função para calcular multa de cancelamento antecipado
CREATE OR REPLACE FUNCTION calcular_multa_cancelamento(p_assinatura_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_ass         plano_assinaturas%ROWTYPE;
  v_cfg         planos_config%ROWTYPE;
  v_meses_rest  int;
  v_multa       numeric;
BEGIN
  SELECT * INTO v_ass FROM plano_assinaturas WHERE id = p_assinatura_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_cfg FROM planos_config WHERE plano_key = v_ass.plano_key;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Só aplica multa se ainda dentro da fidelidade
  IF v_ass.fidelidade_fim IS NULL OR now() >= v_ass.fidelidade_fim THEN
    RETURN 0;
  END IF;

  -- Meses restantes (arredonda pra cima)
  v_meses_rest := CEIL(EXTRACT(EPOCH FROM (v_ass.fidelidade_fim - now())) / (30.0 * 24 * 3600));

  -- Multa = pct × (meses restantes × valor mensal)
  v_multa := (COALESCE(v_cfg.multa_cancelamento_pct, 0) / 100.0)
           * (v_meses_rest * COALESCE(v_ass.valor_mensal, v_cfg.preco, 0));

  RETURN ROUND(v_multa, 2);
END;
$$;
