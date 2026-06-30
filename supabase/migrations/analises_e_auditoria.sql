-- ───────────────────────────────────────────────────────────────────────────
-- Análises (mercadológica + documental) geradas no servidor + ajustes da auditoria.
-- Já aplicado no projeto remoto; este arquivo deixa o schema reproduzível em
-- ambientes novos (supabase db reset / novo projeto).
-- ───────────────────────────────────────────────────────────────────────────

-- Documentos do lote vasculhados na página do leiloeiro (foto/matrícula/edital/anexos)
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS anexos jsonb;
ALTER TABLE imoveis_leilao ADD COLUMN IF NOT EXISTS enriquecido_em timestamptz;

-- Análise MERCADOLÓGICA (gerar-analise.js) — uma linha por (user, imóvel).
CREATE TABLE IF NOT EXISTS analises_mercado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imovel_id text NOT NULL,
  titulo text, cidade text, estado text,
  imovel jsonb, inputs jsonb,
  status text NOT NULL DEFAULT 'gerando',
  result jsonb, erro text,
  data_leilao timestamptz,
  arrematado boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, imovel_id)
);

-- Análise DOCUMENTAL + PROCESSO (gerar-documental.js) — espelha a mercadológica.
CREATE TABLE IF NOT EXISTS analises_documental (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imovel_id text NOT NULL,
  titulo text, cidade text, estado text,
  imovel jsonb, inputs jsonb,
  status text NOT NULL DEFAULT 'gerando',
  result jsonb, erro text,
  data_leilao timestamptz,
  arrematado boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, imovel_id)
);

ALTER TABLE analises_mercado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE analises_documental ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS am_select ON analises_mercado;
DROP POLICY IF EXISTS am_insert ON analises_mercado;
DROP POLICY IF EXISTS am_update ON analises_mercado;
DROP POLICY IF EXISTS am_delete ON analises_mercado;
CREATE POLICY am_select ON analises_mercado FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY am_insert ON analises_mercado FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY am_update ON analises_mercado FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY am_delete ON analises_mercado FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ad_select ON analises_documental;
DROP POLICY IF EXISTS ad_insert ON analises_documental;
DROP POLICY IF EXISTS ad_update ON analises_documental;
DROP POLICY IF EXISTS ad_delete ON analises_documental;
CREATE POLICY ad_select ON analises_documental FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY ad_insert ON analises_documental FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY ad_update ON analises_documental FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY ad_delete ON analises_documental FOR DELETE USING (auth.uid() = user_id);

-- Escalonamento do jurídico ao admin (cap de reatribuições do cron)
ALTER TABLE casos ADD COLUMN IF NOT EXISTS juridico_escalado_admin boolean DEFAULT false;

-- Conteúdo pago: NUNCA expor a URL de mídia (vídeo/PDF) ao papel anônimo.
-- REVOKE de coluna não reduz GRANT de tabela → revoga SELECT de tabela do anon e
-- regranta só metadados. O papel authenticated mantém acesso (área de membros).
REVOKE SELECT ON public.aulas_admin FROM anon;
GRANT SELECT (id, curso_id, modulo, titulo, descricao, duracao, gratis, ordem, criado_em)
  ON public.aulas_admin TO anon;

REVOKE SELECT ON public.ebooks_admin FROM anon;
GRANT SELECT (id, titulo, descricao, capa_url, gratuito, ativo, criado_em, preco, comissao_pct, assinatura)
  ON public.ebooks_admin TO anon;
