CREATE TABLE IF NOT EXISTS public.sdr_produtos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  descricao text,
  tipo text DEFAULT 'ebook' CHECK (tipo IN ('ebook','minicurso','webinar','outro')),
  conteudo_url text,
  imagem_url text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sdr_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id uuid REFERENCES public.sdr_produtos(id),
  nome text NOT NULL,
  whatsapp text NOT NULL,
  email text,
  status text DEFAULT 'novo' CHECK (status IN ('novo','contatado','qualificado','convertido','perdido')),
  origem text,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE public.sdr_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sdr_leads ENABLE ROW LEVEL SECURITY;

-- Produtos: leitura pública (landing pages), escrita apenas admin
CREATE POLICY "produtos_leitura_publica" ON public.sdr_produtos FOR SELECT USING (ativo = true);
CREATE POLICY "produtos_admin" ON public.sdr_produtos FOR ALL USING (
  EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
);

-- Leads: apenas equipe
CREATE POLICY "leads_equipe" ON public.sdr_leads FOR ALL USING (
  EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','consultor'))
);

-- Inserção pública de leads (captura)
CREATE POLICY "leads_insercao_publica" ON public.sdr_leads FOR INSERT WITH CHECK (true);
