-- Distribuição de comissão por papel e por plano
-- + chave PIX para saque
-- + tabela de solicitações de saque

-- 1. Chave PIX no perfil do usuário
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS pix_key text;

-- 2. Distribuição de comissão em planos_config
ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS comissao_total_pct  numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_admin_pct   numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_analista_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_advogado_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comissao_consultor_pct numeric(5,2) DEFAULT 0;

-- 3. Tabela de solicitações de saque
CREATE TABLE IF NOT EXISTS public.saques (
  id           uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  usuario_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  valor        numeric(15,2) NOT NULL,
  pix_key      text NOT NULL,
  status       text NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','aprovado','pago','recusado')),
  observacao   text,
  criado_em    timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

ALTER TABLE public.saques ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saques' AND policyname = 'saques_proprio_usuario'
  ) THEN
    EXECUTE 'CREATE POLICY "saques_proprio_usuario" ON public.saques FOR SELECT USING (auth.uid() = usuario_id)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saques' AND policyname = 'saques_insert_proprio'
  ) THEN
    EXECUTE 'CREATE POLICY "saques_insert_proprio" ON public.saques FOR INSERT WITH CHECK (auth.uid() = usuario_id)';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saques' AND policyname = 'saques_admin_all'
  ) THEN
    EXECUTE 'CREATE POLICY "saques_admin_all" ON public.saques FOR ALL USING (public.is_admin())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saques_usuario  ON public.saques(usuario_id);
CREATE INDEX IF NOT EXISTS idx_saques_status   ON public.saques(status);
