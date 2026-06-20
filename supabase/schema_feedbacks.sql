-- Feedbacks enviados pelos membros (substituindo o mailto)
CREATE TABLE IF NOT EXISTS public.feedbacks (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id),
  user_nome     text,
  user_email    text,
  queixa        text NOT NULL,
  solucao       text,
  resolvido     text,           -- 'Sim' | 'Não' | 'Em andamento'
  nps           integer,        -- 0-10 satisfaction score
  status        text NOT NULL DEFAULT 'novo',  -- novo | em_andamento | resolvido | fechado
  nota_admin    text,           -- anotação interna do admin
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario envia feedback" ON public.feedbacks;
CREATE POLICY "Usuario envia feedback" ON public.feedbacks
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin le feedbacks" ON public.feedbacks;
CREATE POLICY "Admin le feedbacks" ON public.feedbacks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

DROP POLICY IF EXISTS "Admin atualiza feedbacks" ON public.feedbacks;
CREATE POLICY "Admin atualiza feedbacks" ON public.feedbacks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

DROP POLICY IF EXISTS "Usuario ve proprios feedbacks" ON public.feedbacks;
CREATE POLICY "Usuario ve proprios feedbacks" ON public.feedbacks
  FOR SELECT USING (auth.uid() = user_id);
