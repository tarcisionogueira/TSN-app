-- Configuração financeira por gateway (taxas de cartão e antecipação)
CREATE TABLE IF NOT EXISTS public.config_financeira (
  gateway          text PRIMARY KEY,  -- 'mp' (Mercado Pago, principal) | 'asaas' (backup)
  taxa_credito_pct numeric(5,3) DEFAULT 0,    -- MDR cartão crédito (ex: 2.49)
  taxa_debito_pct  numeric(5,3) DEFAULT 0,    -- MDR cartão débito
  antecipacao_ativa boolean DEFAULT false,
  antecipacao_pct_mes numeric(5,3) DEFAULT 0, -- taxa de antecipação ao mês (ex: 1.25)
  prazo_recebimento_dias int DEFAULT 30,       -- D+X padrão
  atualizado_em    timestamptz DEFAULT now()
);

ALTER TABLE public.config_financeira ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='config_financeira' AND policyname='cfg_fin_admin_all'
  ) THEN
    EXECUTE 'CREATE POLICY "cfg_fin_admin_all" ON public.config_financeira FOR ALL USING (public.is_admin())';
  END IF;
END $$;

-- Somente admin lê — mas admins precisam do SELECT liberado
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='config_financeira' AND policyname='cfg_fin_select'
  ) THEN
    EXECUTE 'CREATE POLICY "cfg_fin_select" ON public.config_financeira FOR SELECT USING (public.is_admin())';
  END IF;
END $$;

-- Dados iniciais
INSERT INTO public.config_financeira (gateway, taxa_credito_pct, prazo_recebimento_dias)
VALUES
  ('mp',    0.00, 30),   -- Mercado Pago (principal) — ajuste a MDR no Admin
  ('asaas', 2.49, 32)    -- Asaas (backup de cobrança)
ON CONFLICT (gateway) DO NOTHING;
