-- Campo assinatura (recorrente vs venda única) em todos os produtos
ALTER TABLE public.planos_config ADD COLUMN IF NOT EXISTS assinatura boolean DEFAULT true;
ALTER TABLE public.cursos_admin ADD COLUMN IF NOT EXISTS assinatura boolean DEFAULT false;
ALTER TABLE public.cursos_admin ADD COLUMN IF NOT EXISTS desconto_vista_pct numeric DEFAULT 0;
ALTER TABLE public.ebooks_admin ADD COLUMN IF NOT EXISTS assinatura boolean DEFAULT false;

-- Sincroniza assinatura com cobrar nos planos
UPDATE public.planos_config SET assinatura = cobrar;

-- Tabela de contratos obrigatórios pendentes (vincular compra → contrato)
CREATE TABLE IF NOT EXISTS public.contratos_pendentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_tipo text NOT NULL CHECK (produto_tipo IN ('plano','curso','ebook')),
  produto_id text NOT NULL,
  contrato_link_id uuid REFERENCES public.contratos_link(id) ON DELETE SET NULL,
  status text DEFAULT 'aguardando' CHECK (status IN ('aguardando','assinado','expirado')),
  criado_em timestamptz DEFAULT now(),
  assinado_em timestamptz,
  expira_em timestamptz DEFAULT (now() + interval '30 days'),
  UNIQUE(user_id, produto_tipo, produto_id)
);

ALTER TABLE public.contratos_pendentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuario ve proprios contratos pendentes" ON public.contratos_pendentes;
CREATE POLICY "Usuario ve proprios contratos pendentes" ON public.contratos_pendentes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin gerencia contratos pendentes" ON public.contratos_pendentes;
CREATE POLICY "Admin gerencia contratos pendentes" ON public.contratos_pendentes
  USING (EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista')));
