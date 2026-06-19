-- Configuração de preços dos planos — editável pelo admin
CREATE TABLE IF NOT EXISTS public.planos_config (
  plano_key    text        PRIMARY KEY,
  nome         text        NOT NULL,
  preco        numeric     NOT NULL DEFAULT 0,
  preco_vista  numeric,
  cobrar       boolean     NOT NULL DEFAULT false,
  ativo        boolean     NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.planos_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'planos_config' AND policyname = 'planos_config_select'
  ) THEN
    EXECUTE 'CREATE POLICY "planos_config_select" ON public.planos_config FOR SELECT USING (true)';
  END IF;
END $$;

-- Dados iniciais (não sobrescreve se já existir)
INSERT INTO public.planos_config (plano_key, nome, preco, preco_vista, cobrar) VALUES
  ('top1',        'Investidor',          49.90,   null,   true),
  ('top2',        'Investidor Pro',      99.90,   null,   true),
  ('assessorado', 'Assessorado',        500.00,  5000.00, true),
  ('clube',       'Clube de Negócios', 5000.00, 48000.00, true),
  ('analista',    'Analista',             0.00,   null,  false),
  ('advogado',    'Advogado Parceiro',    0.00,   null,  false),
  ('consultor',   'Consultor/Afiliado',   0.00,   null,  false)
ON CONFLICT (plano_key) DO NOTHING;
