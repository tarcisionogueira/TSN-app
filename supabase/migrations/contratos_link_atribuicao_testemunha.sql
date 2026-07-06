-- Reformulação dos contratos: dá ao `contratos_link` (a) ATRIBUIÇÃO a um
-- plano/produto e (b) colunas de TESTEMUNHA (que o app já escrevia, mas não
-- existiam — as gravações falhavam em silêncio) e (c) as PARTES nomeadas.
--
--  - plano_key / produto_tipo / produto_id: o contrato passa a ser vinculado ao
--    produto pela CHAVE (não mais por convenção de título "Contrato — {nome}").
--    Admin > Produtos passa a só EXIBIR/VER o contrato atribuído por aqui.
--  - partes: partes nomeadas do contrato (nome/qualificação), além do signatário.
--  - testemunha: nome/cpf/assinatura/data — permite assinatura de testemunhas.
ALTER TABLE contratos_link
  ADD COLUMN IF NOT EXISTS plano_key text,
  ADD COLUMN IF NOT EXISTS produto_tipo text,       -- 'plano' | 'curso' | 'ebook'
  ADD COLUMN IF NOT EXISTS produto_id text,
  ADD COLUMN IF NOT EXISTS partes jsonb,
  ADD COLUMN IF NOT EXISTS nome_testemunha text,
  ADD COLUMN IF NOT EXISTS cpf_testemunha text,
  ADD COLUMN IF NOT EXISTS assinatura_testemunha text,
  ADD COLUMN IF NOT EXISTS testemunha_em timestamptz,
  -- Multi-signatário: um LINK POR ASSINANTE (cada parte assina o seu). As linhas
  -- do MESMO contrato compartilham este grupo (mesmo conteúdo/plano, tokens/emails
  -- diferentes). Todos recebem por e-mail e podem compartilhar o link.
  ADD COLUMN IF NOT EXISTS contrato_grupo_id uuid;

CREATE INDEX IF NOT EXISTS idx_contratos_link_plano ON contratos_link(plano_key) WHERE plano_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_link_grupo ON contratos_link(contrato_grupo_id) WHERE contrato_grupo_id IS NOT NULL;
