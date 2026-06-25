-- Corrige distribuição de honorários e adiciona trava de preço 12 meses
-- Execute no SQL Editor do Supabase

-- 1. Cria/atualiza config_honorarios com os valores corretos
CREATE TABLE IF NOT EXISTS public.config_honorarios (
  id              int PRIMARY KEY DEFAULT 1,
  total_pct       numeric(5,2) DEFAULT 10,
  admin_pct       numeric(5,2) DEFAULT 4.5,
  advogado_pct    numeric(5,2) DEFAULT 5.0,
  analista_pct    numeric(5,2) DEFAULT 0.5,
  consultor_pct   numeric(5,2) DEFAULT 0,   -- consultor NUNCA participa de êxito
  atualizado_em   timestamptz DEFAULT now(),
  atualizado_por  uuid
);

-- Garante apenas 1 linha
INSERT INTO public.config_honorarios (id, total_pct, admin_pct, advogado_pct, analista_pct, consultor_pct)
VALUES (1, 10, 4.5, 5.0, 0.5, 0)
ON CONFLICT (id) DO UPDATE SET
  advogado_pct  = 5.0,
  analista_pct  = 0.5,
  consultor_pct = 0,
  atualizado_em = now();

ALTER TABLE public.config_honorarios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='config_honorarios' AND policyname='admin_honorarios') THEN
    EXECUTE $pol$CREATE POLICY "admin_honorarios" ON public.config_honorarios
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))$pol$;
  END IF;
END $$;

-- 2. Override individual de honorários por usuário
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS honorario_advogado_pct  numeric(5,2),  -- null = usa config global
  ADD COLUMN IF NOT EXISTS honorario_analista_pct   numeric(5,2);  -- null = usa config global

-- 3. Trava de preço 12 meses para assinaturas (top2 = Investidor Pro, clube = Leilão Club)
-- A RPC registrar_preco_contratado já existe; garante a tabela preco_contratado
CREATE TABLE IF NOT EXISTS public.preco_contratado (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users NOT NULL,
  plano_key       text NOT NULL,
  preco_mensal    numeric(12,2) NOT NULL,
  contratado_em   timestamptz NOT NULL DEFAULT now(),
  valido_ate      timestamptz NOT NULL,  -- contratado_em + 12 meses
  ativo           boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preco_contratado_user  ON public.preco_contratado(user_id);
CREATE INDEX IF NOT EXISTS idx_preco_contratado_plano ON public.preco_contratado(plano_key, ativo);

ALTER TABLE public.preco_contratado ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='preco_contratado' AND policyname='pc_proprio') THEN
    EXECUTE $pol$CREATE POLICY "pc_proprio" ON public.preco_contratado
      FOR SELECT TO authenticated USING (auth.uid() = user_id)$pol$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='preco_contratado' AND policyname='pc_admin') THEN
    EXECUTE $pol$CREATE POLICY "pc_admin" ON public.preco_contratado
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role = 'admin'))$pol$;
  END IF;
END $$;

-- 4. Função: registra preço travado ao confirmar assinatura (chama do webhook)
CREATE OR REPLACE FUNCTION public.registrar_preco_contratado(p_user_id uuid, p_plano_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_preco numeric;
BEGIN
  -- Planos com trava de 12 meses: apenas assinaturas pagas
  IF p_plano_key NOT IN ('top2', 'clube') THEN RETURN; END IF;

  SELECT preco INTO v_preco FROM planos_config WHERE plano_key = p_plano_key;
  IF v_preco IS NULL THEN RETURN; END IF;

  -- Desativa trava anterior do mesmo plano para este usuário
  UPDATE public.preco_contratado
  SET ativo = false
  WHERE user_id = p_user_id AND plano_key = p_plano_key AND ativo = true;

  -- Registra nova trava (12 meses a partir de hoje)
  INSERT INTO public.preco_contratado (user_id, plano_key, preco_mensal, contratado_em, valido_ate)
  VALUES (p_user_id, p_plano_key, v_preco, now(), now() + interval '12 months');
END;
$$;

-- 5. Função: retorna preço vigente para um usuário (travado ou atual do plano)
CREATE OR REPLACE FUNCTION public.preco_vigente(p_user_id uuid, p_plano_key text)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_travado numeric;
  v_atual   numeric;
BEGIN
  -- Busca preço travado ainda válido
  SELECT preco_mensal INTO v_travado
  FROM public.preco_contratado
  WHERE user_id = p_user_id
    AND plano_key = p_plano_key
    AND ativo = true
    AND valido_ate > now()
  ORDER BY contratado_em DESC
  LIMIT 1;

  IF v_travado IS NOT NULL THEN RETURN v_travado; END IF;

  -- Sem trava: retorna preço atual do plano
  SELECT preco INTO v_atual FROM planos_config WHERE plano_key = p_plano_key;
  RETURN COALESCE(v_atual, 0);
END;
$$;

-- 6. View: assinantes com preço travado (para o admin saber impacto ao mudar preço)
CREATE OR REPLACE VIEW public.assinantes_preco_travado AS
SELECT
  pc.user_id,
  p.nome AS nome_usuario,
  pc.plano_key,
  pc.preco_mensal AS preco_travado,
  pl.preco       AS preco_atual,
  pc.contratado_em,
  pc.valido_ate,
  CEIL(EXTRACT(EPOCH FROM (pc.valido_ate - now())) / (30.0 * 24 * 3600))::int AS meses_restantes
FROM public.preco_contratado pc
JOIN public.perfis p ON p.id = pc.user_id
JOIN public.planos_config pl ON pl.plano_key = pc.plano_key
WHERE pc.ativo = true AND pc.valido_ate > now()
ORDER BY pc.valido_ate ASC;
