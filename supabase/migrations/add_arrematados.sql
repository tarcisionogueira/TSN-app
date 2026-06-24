-- Sistema de Imóveis Arrematados
-- Rodar manualmente no Supabase SQL Editor

-- 1. Campo status em imoveis_leilao
ALTER TABLE public.imoveis_leilao
  ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'disponivel';
-- status: 'disponivel' | 'arrematado' | 'retirado'

-- 2. Arrematações
CREATE TABLE IF NOT EXISTS public.arrematacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imovel_id uuid NOT NULL REFERENCES public.imoveis_leilao(id) ON DELETE RESTRICT,
  arrematante_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  valor_arrematado numeric(15,2),
  data_leilao date,
  leiloeiro varchar(200),
  numero_processo varchar(100),
  status varchar(20) NOT NULL DEFAULT 'em_processo',
  -- status: 'em_processo' | 'finalizado' | 'cancelado'
  observacoes text,
  criado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- 3. Documentos do processo/imóvel
CREATE TABLE IF NOT EXISTS public.imovel_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrematacao_id uuid REFERENCES public.arrematacoes(id) ON DELETE CASCADE,
  imovel_id uuid NOT NULL REFERENCES public.imoveis_leilao(id) ON DELETE CASCADE,
  tipo varchar(50) NOT NULL DEFAULT 'outro',
  -- tipo: 'edital'|'auto_arrematacao'|'carta_arrematacao'|'matricula'|'contrato'|'procuracao'|'outro'
  nome varchar(300) NOT NULL,
  url text NOT NULL,
  tamanho_kb integer,
  criado_por uuid REFERENCES auth.users(id),
  role_criador varchar(30),
  criado_em timestamptz DEFAULT now()
);

-- 4. Documentos pessoais do usuário
CREATE TABLE IF NOT EXISTS public.usuario_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  arrematacao_id uuid REFERENCES public.arrematacoes(id) ON DELETE SET NULL,
  tipo varchar(50) NOT NULL DEFAULT 'outro',
  -- tipo: 'identidade'|'comprovante_pagamento'|'procuracao'|'cnd'|'outro'
  nome varchar(300) NOT NULL,
  url text NOT NULL,
  tamanho_kb integer,
  criado_em timestamptz DEFAULT now(),
  expira_em timestamptz -- preenchido ao cancelar assinatura: data_cancelamento + 90 dias
);

-- RLS
ALTER TABLE public.arrematacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imovel_anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_docs ENABLE ROW LEVEL SECURITY;

-- arrematacoes: arrematante vê as suas; admin/analista/advogado/consultor veem todas
CREATE POLICY "arrematacoes_select" ON public.arrematacoes FOR SELECT
  USING (
    arrematante_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','advogado','consultor'))
  );
CREATE POLICY "arrematacoes_insert" ON public.arrematacoes FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );
CREATE POLICY "arrematacoes_update" ON public.arrematacoes FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

-- imovel_anexos: arrematante vê; admin/analista/advogado escrevem e veem
CREATE POLICY "imovel_anexos_select" ON public.imovel_anexos FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.arrematacoes a WHERE a.id = arrematacao_id AND a.arrematante_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','advogado'))
  );
CREATE POLICY "imovel_anexos_insert" ON public.imovel_anexos FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista','advogado'))
  );
CREATE POLICY "imovel_anexos_delete" ON public.imovel_anexos FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

-- usuario_docs: só o próprio usuário e admin/analista
CREATE POLICY "usuario_docs_select" ON public.usuario_docs FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );
CREATE POLICY "usuario_docs_insert" ON public.usuario_docs FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );
CREATE POLICY "usuario_docs_delete" ON public.usuario_docs FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('admin','analista'))
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_arrematacoes_imovel ON public.arrematacoes(imovel_id);
CREATE INDEX IF NOT EXISTS idx_arrematacoes_arrematante ON public.arrematacoes(arrematante_id);
CREATE INDEX IF NOT EXISTS idx_imovel_anexos_arrematacao ON public.imovel_anexos(arrematacao_id);
CREATE INDEX IF NOT EXISTS idx_imovel_anexos_imovel ON public.imovel_anexos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_usuario_docs_user ON public.usuario_docs(user_id);
CREATE INDEX IF NOT EXISTS idx_usuario_docs_expira ON public.usuario_docs(expira_em) WHERE expira_em IS NOT NULL;
