-- ================================================================
-- Proteção contra chargeback
-- ================================================================

-- Log de aceite de plano: gravado no momento do pagamento
CREATE TABLE IF NOT EXISTS public.aceites_plano (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id),
  user_email    text NOT NULL,
  plano_key     text NOT NULL,
  valor         numeric NOT NULL,
  asaas_payment_id text,
  asaas_subscription_id text,
  ip            text,
  user_agent    text,
  termos_versao text NOT NULL DEFAULT '1.0',
  aceito_em     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aceites_plano ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario insere proprio aceite" ON public.aceites_plano;
CREATE POLICY "Usuario insere proprio aceite" ON public.aceites_plano
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin le aceites" ON public.aceites_plano;
CREATE POLICY "Admin le aceites" ON public.aceites_plano
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

DROP POLICY IF EXISTS "Usuario ve proprio aceite" ON public.aceites_plano;
CREATE POLICY "Usuario ve proprio aceite" ON public.aceites_plano
  FOR SELECT USING (auth.uid() = user_id);

-- Log de uso do serviço: cada ação relevante do membro
CREATE TABLE IF NOT EXISTS public.uso_servico (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id),
  acao       text NOT NULL,  -- 'login', 'relatorio_gerado', 'busca', 'analise', 'contrato_assinado'
  detalhes   jsonb,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.uso_servico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sistema insere uso" ON public.uso_servico;
CREATE POLICY "Sistema insere uso" ON public.uso_servico
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin le uso" ON public.uso_servico;
CREATE POLICY "Admin le uso" ON public.uso_servico
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_aceites_user ON public.aceites_plano(user_id);
CREATE INDEX IF NOT EXISTS idx_aceites_email ON public.aceites_plano(user_email);
CREATE INDEX IF NOT EXISTS idx_uso_user ON public.uso_servico(user_id);
CREATE INDEX IF NOT EXISTS idx_uso_acao ON public.uso_servico(acao);
