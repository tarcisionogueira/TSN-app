-- Configuração de honorários de êxito na arrematação
-- Linha única (id=1). Percentuais editáveis pelo admin.
-- Regra: admin_pct + advogado_pct + analista_pct = total_pct (padrão 10%)

CREATE TABLE IF NOT EXISTS public.config_honorarios (
  id              int PRIMARY KEY DEFAULT 1,
  total_pct       numeric(5,2) NOT NULL DEFAULT 10,    -- total fixo (10%)
  admin_pct       numeric(5,2) NOT NULL DEFAULT 4.5,   -- repasse admin
  advogado_pct    numeric(5,2) NOT NULL DEFAULT 4.5,   -- repasse advogado
  analista_pct    numeric(5,2) NOT NULL DEFAULT 1,     -- repasse analista
  atualizado_em   timestamptz DEFAULT now()
);

-- Garante linha única
INSERT INTO public.config_honorarios (id, total_pct, admin_pct, advogado_pct, analista_pct)
VALUES (1, 10, 4.5, 4.5, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.config_honorarios ENABLE ROW LEVEL SECURITY;

-- Somente admin lê e altera
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='config_honorarios' AND policyname='honorarios_admin'
  ) THEN
    EXECUTE 'CREATE POLICY "honorarios_admin" ON public.config_honorarios FOR ALL USING (public.is_admin())';
  END IF;
END $$;
