-- Histórico de buscas (rastreamento silencioso)
CREATE TABLE IF NOT EXISTS public.busca_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  filtros jsonb NOT NULL DEFAULT '{}',
  resultados_count int DEFAULT 0,
  cidade text,
  estado text,
  tipo_imovel text,
  valor_min numeric,
  valor_max numeric,
  desconto_min int,
  pagamento_tipos text[],
  sort_usado text,
  ip_hash text,
  criado_em timestamptz DEFAULT now()
);

-- Alertas de email configurados automaticamente pelo padrão de busca
CREATE TABLE IF NOT EXISTS public.alertas_email (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  filtros jsonb NOT NULL DEFAULT '{}',
  descricao text,
  ativo boolean DEFAULT true,
  ultimo_envio timestamptz,
  total_enviados int DEFAULT 0,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE public.busca_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_email ENABLE ROW LEVEL SECURITY;

-- busca_historico: insert público (rastreamento anônimo/logado), leitura apenas equipe
CREATE POLICY "bh_insert" ON public.busca_historico FOR INSERT WITH CHECK (true);
CREATE POLICY "bh_equipe" ON public.busca_historico FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
);

-- alertas_email: usuário vê os seus, equipe vê todos
CREATE POLICY "ae_proprios" ON public.alertas_email FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "ae_equipe" ON public.alertas_email FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
);
