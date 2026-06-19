-- Tickets de suporte
CREATE TABLE IF NOT EXISTS public.chamados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  user_email text,
  user_nome text,
  titulo text NOT NULL,
  status text DEFAULT 'aberto' CHECK (status IN ('aberto','em_atendimento','finalizado')),
  atendente_id uuid REFERENCES auth.users(id),
  atendente_nome text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- Mensagens dos chamados
CREATE TABLE IF NOT EXISTS public.chamados_mensagens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chamado_id uuid REFERENCES public.chamados(id) ON DELETE CASCADE NOT NULL,
  autor_id uuid REFERENCES auth.users(id),
  autor_nome text,
  autor_tipo text NOT NULL CHECK (autor_tipo IN ('cliente','atendente','ia')),
  conteudo text NOT NULL,
  anexos jsonb DEFAULT '[]',
  criado_em timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.chamados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamados_mensagens ENABLE ROW LEVEL SECURITY;

-- Clientes veem apenas seus chamados
CREATE POLICY IF NOT EXISTS "chamados_proprio_usuario" ON public.chamados
  FOR ALL USING (auth.uid() = user_id);

-- Staff vê todos os chamados
CREATE POLICY IF NOT EXISTS "chamados_staff" ON public.chamados
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','consultor','advogado'))
  );

-- Mensagens: clientes só do seu chamado
CREATE POLICY IF NOT EXISTS "mensagens_proprio_chamado" ON public.chamados_mensagens
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.chamados WHERE id = chamado_id AND user_id = auth.uid())
  );

-- Mensagens: staff vê todas
CREATE POLICY IF NOT EXISTS "mensagens_staff" ON public.chamados_mensagens
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','consultor','advogado'))
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chamados;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chamados_mensagens;
