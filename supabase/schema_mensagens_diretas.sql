-- Mensagens diretas de consultor para cliente
CREATE TABLE IF NOT EXISTS public.mensagens_diretas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_consultor_id uuid REFERENCES public.perfis(id) ON DELETE SET NULL,
  para_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  para_email text,
  assunto text,
  conteudo text NOT NULL,
  lido boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE public.mensagens_diretas ENABLE ROW LEVEL SECURITY;

-- Cliente vê só as próprias mensagens
CREATE POLICY "cliente_le_proprias" ON public.mensagens_diretas
  FOR SELECT USING (auth.uid() = para_user_id);

-- Consultor insere mensagens para seus clientes
CREATE POLICY "consultor_insere" ON public.mensagens_diretas
  FOR INSERT WITH CHECK (auth.uid() = de_consultor_id);

-- Consultor vê mensagens que enviou
CREATE POLICY "consultor_le_enviadas" ON public.mensagens_diretas
  FOR SELECT USING (auth.uid() = de_consultor_id);

CREATE INDEX IF NOT EXISTS idx_msgs_diretas_para ON public.mensagens_diretas(para_user_id);
CREATE INDEX IF NOT EXISTS idx_msgs_diretas_lido ON public.mensagens_diretas(lido) WHERE lido = false;
