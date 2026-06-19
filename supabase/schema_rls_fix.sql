-- ─── 1. Adiciona coluna assinante_email em contratos_link ─────────────────────
-- (necessária para vincular contratos ao usuário pelo e-mail antes da assinatura)
ALTER TABLE public.contratos_link
  ADD COLUMN IF NOT EXISTS assinante_email text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_contratos_link_assinante_email
  ON public.contratos_link(assinante_email);

-- ─── 2. RLS: assinante lê e assina contratos endereçados ao seu e-mail ────────
DROP POLICY IF EXISTS "Assinante lê próprios contratos_link" ON public.contratos_link;
DROP POLICY IF EXISTS "Assinante pode assinar próprio contrato_link" ON public.contratos_link;

CREATE POLICY "Assinante lê próprios contratos_link"
  ON public.contratos_link FOR SELECT
  USING (assinante_email = auth.email());

CREATE POLICY "Assinante pode assinar próprio contrato_link"
  ON public.contratos_link FOR UPDATE
  USING (assinante_email = auth.email() AND status = 'aguardando');

-- ─── 3. RLS: políticas de perfis (own-row, seguras contra conflito) ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'perfis' AND policyname = 'Usuário lê próprio perfil'
  ) THEN
    EXECUTE 'CREATE POLICY "Usuário lê próprio perfil"
      ON public.perfis FOR SELECT USING (id = auth.uid())';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'perfis' AND policyname = 'Usuário atualiza próprio perfil'
  ) THEN
    EXECUTE 'CREATE POLICY "Usuário atualiza próprio perfil"
      ON public.perfis FOR UPDATE USING (id = auth.uid())';
  END IF;
END $$;
