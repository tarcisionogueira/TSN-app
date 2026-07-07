-- Histórico de imóveis já enviados no e-mail de oportunidades (por usuário), para
-- NÃO repetir imóvel entre envios — salvo quando não houver novos. Escrito pelo
-- cron (service_role, bypassa RLS). Usuário pode ver os seus.
CREATE TABLE IF NOT EXISTS public.alertas_enviados (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imovel_id  uuid NOT NULL,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, imovel_id)
);
CREATE INDEX IF NOT EXISTS idx_alertas_enviados_user ON public.alertas_enviados(user_id, enviado_em DESC);

ALTER TABLE public.alertas_enviados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ae_env_proprios" ON public.alertas_enviados;
CREATE POLICY "ae_env_proprios" ON public.alertas_enviados
  FOR SELECT USING (auth.uid() = user_id);
