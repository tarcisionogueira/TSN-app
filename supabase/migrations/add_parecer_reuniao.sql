-- ═══════════════════════════════════════════════════════════════════════
-- Parecer do analista na reunião (aprovado/reprovado para arrematação)
-- Amarra o fluxo: só com parecer 'aprovado' o caso segue para o jurídico.
-- O advogado tem seu próprio parecer (analise_juridica.resultado); este é
-- um artefato distinto e anterior, do analista, na 1ª reunião.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.reunioes
  ADD COLUMN IF NOT EXISTS parecer_arrematacao text
    CHECK (parecer_arrematacao IN ('aprovado','reprovado'));

COMMENT ON COLUMN public.reunioes.parecer_arrematacao IS
  'Parecer do analista ao concluir a reunião: aprovado libera o encaminhamento ao jurídico; reprovado encerra o fluxo de arrematação.';
