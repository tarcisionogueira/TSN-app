-- ================================================================
-- Adiciona flag requer_contrato em planos e cursos
-- ================================================================

ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS requer_contrato boolean NOT NULL DEFAULT false;

ALTER TABLE public.cursos_admin
  ADD COLUMN IF NOT EXISTS requer_contrato boolean NOT NULL DEFAULT false;
