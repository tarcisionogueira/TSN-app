-- ============================================================
-- Correção da tabela planos_config
-- 1. Adiciona colunas faltantes
-- 2. Adiciona política RLS de UPDATE para admin
-- Execute no Supabase SQL Editor
-- ============================================================

-- 1. Colunas faltantes
ALTER TABLE public.planos_config
  ADD COLUMN IF NOT EXISTS desconto_vista_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assinatura          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comissao_pct        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requer_contrato     boolean NOT NULL DEFAULT false;

-- Sincroniza assinatura com cobrar (mesma semântica)
UPDATE public.planos_config SET assinatura = cobrar WHERE assinatura <> cobrar;

-- 2. Política de UPDATE para admin (usa a coluna role da tabela perfis)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'planos_config' AND policyname = 'planos_config_update_admin'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "planos_config_update_admin"
        ON public.planos_config
        FOR UPDATE
        USING (
          EXISTS (
            SELECT 1 FROM public.perfis
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.perfis
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
    $pol$;
  END IF;
END $$;

-- 3. Política de INSERT para admin (caso precise adicionar novos planos)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'planos_config' AND policyname = 'planos_config_insert_admin'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "planos_config_insert_admin"
        ON public.planos_config
        FOR INSERT
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.perfis
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
    $pol$;
  END IF;
END $$;

-- Verificação
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'planos_config'
ORDER BY ordinal_position;
