CREATE TABLE IF NOT EXISTS public.health_check_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executado_em timestamptz DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ok','aviso','erro')),
  resumo text,
  itens jsonb DEFAULT '[]'::jsonb,
  duracao_ms int
);

ALTER TABLE public.health_check_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_le_health" ON public.health_check_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_health_check_executado ON public.health_check_logs(executado_em DESC);
