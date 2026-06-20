-- Add KYC columns to contratos_link
ALTER TABLE public.contratos_link
  ADD COLUMN IF NOT EXISTS kyc_incluido boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS kyc_fotos    jsonb;

-- Add kyc_fotos to convites_equipe
ALTER TABLE public.convites_equipe
  ADD COLUMN IF NOT EXISTS kyc_fotos jsonb;

CREATE INDEX IF NOT EXISTS idx_contratos_kyc ON public.contratos_link(kyc_incluido) WHERE kyc_incluido = true;
