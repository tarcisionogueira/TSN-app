-- SDR v2: questionário customizável + produtos expandidos + respostas armazenadas
ALTER TABLE public.sdr_produtos
  ADD COLUMN IF NOT EXISTS perguntas jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS produto_ref_tipo text,   -- 'curso' | 'ebook' | 'calculadora' | 'plano' | 'plataforma'
  ADD COLUMN IF NOT EXISTS produto_ref_id uuid,      -- id do curso ou ebook (null para calculadora/plataforma)
  ADD COLUMN IF NOT EXISTS plano_liberado text DEFAULT 'explorador', -- role a ser concedido
  ADD COLUMN IF NOT EXISTS mensagem_boas_vindas text;

ALTER TABLE public.sdr_leads
  ADD COLUMN IF NOT EXISTS respostas jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consultor_id uuid REFERENCES public.perfis(id) ON DELETE SET NULL;

-- Índice para relatórios por produto
CREATE INDEX IF NOT EXISTS idx_sdr_leads_produto ON public.sdr_leads(produto_id);
CREATE INDEX IF NOT EXISTS idx_sdr_leads_status ON public.sdr_leads(status);
