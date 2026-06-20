CREATE TABLE IF NOT EXISTS public.filtros_salvos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nome text NOT NULL,
  filtros jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE public.filtros_salvos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fs_proprios" ON public.filtros_salvos FOR ALL USING (auth.uid() = user_id);
