-- Validação de identidade (selfie + documento) para assessorado e clube
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS identidade_validada boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS identidade_validada_em timestamptz,
  ADD COLUMN IF NOT EXISTS identidade_pendente boolean DEFAULT false;
-- identidade_pendente = true enquanto aguarda revisão manual (quando Claude não aprovou automaticamente)
