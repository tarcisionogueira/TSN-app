-- Vincula chamados ao fluxo de análise de imóveis
ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS caso_id uuid REFERENCES public.casos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chamados_caso ON public.chamados(caso_id);

-- Adiciona coluna role do remetente nas mensagens (para exibir analista/advogado/cliente)
ALTER TABLE public.chamados_mensagens
  ADD COLUMN IF NOT EXISTS remetente_role text;
