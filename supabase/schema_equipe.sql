-- Extend solicitacoes with checklist and analyst notes
ALTER TABLE public.solicitacoes
  ADD COLUMN IF NOT EXISTS checklist jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notas_analista text,
  ADD COLUMN IF NOT EXISTS google_meet_link text,
  ADD COLUMN IF NOT EXISTS roles_analista text[]; -- múltiplos roles por analista

-- Team invites table (separate from client links_convite)
CREATE TABLE IF NOT EXISTS public.convites_equipe (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token       text UNIQUE NOT NULL,
  roles       text[] NOT NULL,              -- e.g. ['analista'] or ['analista','advogado']
  descricao   text,
  criado_por  uuid REFERENCES auth.users(id),
  criado_em   timestamptz DEFAULT now(),
  expira_em   timestamptz DEFAULT now() + interval '30 days',
  usado_em    timestamptz,
  usado_por   uuid REFERENCES auth.users(id),
  ativo       boolean NOT NULL DEFAULT true
);

ALTER TABLE public.convites_equipe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin gerencia convites equipe" ON public.convites_equipe
  USING (EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Allow public to read active invites (for accept page)
CREATE POLICY "Público lê convites equipe ativos" ON public.convites_equipe
  FOR SELECT USING (ativo = true AND (expira_em IS NULL OR expira_em > now()));

CREATE INDEX IF NOT EXISTS idx_convites_equipe_token ON public.convites_equipe(token);
