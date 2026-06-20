-- Configuração do gateway de pagamento ativo
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Apenas admins leem e escrevem
CREATE POLICY "Admin gerencia config" ON public.app_config
  USING (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'admin'));

-- Permite leitura via service key (funções serverless)
-- (a service key bypassa RLS por padrão — não é necessário policy adicional)

-- Valores iniciais
INSERT INTO public.app_config (key, value) VALUES
  ('gateway_ativo',               'asaas'),
  ('gateway_falhas_consecutivas', '0'),
  ('gateway_ultima_falha',        ''),
  ('gateway_failover_auto',       'true'),
  ('gateway_falhas_limite',       '3')
ON CONFLICT (key) DO NOTHING;
