-- Preço anual nas assinaturas (Item 7 — cobrança anual)
ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS preco_anual numeric(10,2) DEFAULT NULL;

-- Coluna de ciclo no perfil do usuário (mensal ou anual)
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS plano_ciclo text DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS plano_vencimento date DEFAULT NULL;

COMMENT ON COLUMN public.planos_config.preco_anual IS 'Preço cobrado anualmente (renovação automática em 12 meses)';
COMMENT ON COLUMN public.perfis.plano_ciclo IS 'mensal | anual';
COMMENT ON COLUMN public.perfis.plano_vencimento IS 'Data de vencimento do plano atual';
