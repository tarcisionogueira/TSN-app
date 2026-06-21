-- Compras avulsas de cursos e ebooks (fora da assinatura)
CREATE TABLE IF NOT EXISTS public.compras_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_tipo text NOT NULL CHECK (produto_tipo IN ('curso', 'ebook')),
  produto_id uuid NOT NULL,
  valor numeric(10,2) DEFAULT 0,
  status text DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE public.compras_produtos ENABLE ROW LEVEL SECURITY;

-- Usuário vê suas próprias compras
CREATE POLICY "usuario_le_proprias_compras" ON public.compras_produtos
  FOR SELECT USING (auth.uid() = user_id);

-- Apenas service key insere (via API)
CREATE POLICY "service_insere_compras" ON public.compras_produtos
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_compras_user ON public.compras_produtos(user_id);
CREATE INDEX IF NOT EXISTS idx_compras_produto ON public.compras_produtos(produto_tipo, produto_id);
