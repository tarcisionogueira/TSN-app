-- ════════════════════════════════════════════════════════════════════════════
-- Cotas de IA por plano — FONTE ÚNICA (limite_ia) + documental medido no servidor
-- Rodar no SQL Editor do Supabase. Aditivo e idempotente.
--
-- Regra: TODOS os acessos têm limite; só o admin é ilimitado.
--   mercadológico:   explorador 5 · top2/assessorado/clube 15 · equipe 100 · admin ∞
--   documental+jur.: explorador 0 · top2/assessorado/clube 15 · equipe 100 · admin ∞
-- Documental e jurídico saem na MESMA geração → contam no mesmo balde documental.
-- Bônus (bonus_mercado/bonus_documental, concedidos pelo admin) somam POR CIMA do
-- limite mensal. O consumo é feito no servidor (service_role) onde o custo ocorre.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Contadores do documental (o mercadológico já usa analises_count/analises_mes)
ALTER TABLE public.perfis ADD COLUMN IF NOT EXISTS documental_count int NOT NULL DEFAULT 0;
ALTER TABLE public.perfis ADD COLUMN IF NOT EXISTS documental_mes   text;

-- 2) Fonte ÚNICA dos limites (NULL = ilimitado). Um lugar só para ajustar números.
CREATE OR REPLACE FUNCTION public.limite_ia(p_role text, p_tipo text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_role = 'admin' THEN NULL::int                    -- admin: ilimitado
    WHEN p_tipo = 'documental' THEN CASE p_role
      WHEN 'top2' THEN 15 WHEN 'top2_anual' THEN 15
      WHEN 'assessorado' THEN 15 WHEN 'assessorado_anual' THEN 15
      WHEN 'clube' THEN 15 WHEN 'clube_anual' THEN 15
      WHEN 'analista' THEN 100 WHEN 'advogado' THEN 100      -- equipe (ajustável)
      ELSE 0 END                                            -- explorador/consultor/sem-perfil: sem documental
    ELSE CASE p_role                                        -- mercadológico
      WHEN 'explorador' THEN 5 WHEN 'consultor' THEN 5
      WHEN 'top2' THEN 15 WHEN 'top2_anual' THEN 15
      WHEN 'assessorado' THEN 15 WHEN 'assessorado_anual' THEN 15
      WHEN 'clube' THEN 15 WHEN 'clube_anual' THEN 15
      WHEN 'analista' THEN 100 WHEN 'advogado' THEN 100      -- equipe (ajustável)
      ELSE 5 END
  END
$$;

-- 3) Consome cota MERCADOLÓGICA (mensal; quando esgota, usa bônus por cima).
CREATE OR REPLACE FUNCTION public.consumir_analise_por(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_limite int; v_count int; v_mes text; v_bonus int;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT role, coalesce(analises_count,0), analises_mes, coalesce(bonus_mercado,0)
    INTO v_role, v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia(v_role, 'mercado');
  IF v_limite IS NULL THEN RETURN jsonb_build_object('ok',true,'ilimitado',true); END IF;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  IF v_count < v_limite THEN
    UPDATE perfis SET analises_count = v_count + 1, analises_mes = v_mes_atual WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  END IF;
  IF v_bonus > 0 THEN
    UPDATE perfis SET bonus_mercado = v_bonus - 1 WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
  END IF;
  RETURN jsonb_build_object('ok',false,'erro','limite_mensal','usadas',v_count,'limite',v_limite);
END; $$;

-- 4) Consome cota DOCUMENTAL+JURÍDICA (mesmo padrão; explorador tem limite 0).
CREATE OR REPLACE FUNCTION public.consumir_documental_por(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_limite int; v_count int; v_mes text; v_bonus int;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT role, coalesce(documental_count,0), documental_mes, coalesce(bonus_documental,0)
    INTO v_role, v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia(v_role, 'documental');
  IF v_limite IS NULL THEN RETURN jsonb_build_object('ok',true,'ilimitado',true); END IF;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  IF v_count < v_limite THEN
    UPDATE perfis SET documental_count = v_count + 1, documental_mes = v_mes_atual WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  END IF;
  IF v_bonus > 0 THEN
    UPDATE perfis SET bonus_documental = v_bonus - 1 WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
  END IF;
  RETURN jsonb_build_object('ok',false,
    'erro', CASE WHEN v_limite = 0 THEN 'sem_documental' ELSE 'limite_mensal' END,
    'usadas',v_count,'limite',v_limite);
END; $$;

-- 5) Versão auth.uid() (compat) → delega ao mesmo modelo, sem duplicar regra.
CREATE OR REPLACE FUNCTION public.consumir_analise()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  RETURN public.consumir_analise_por(v_uid);
END; $$;

-- Consumo é só do servidor (service_role); nunca exposto ao cliente.
REVOKE ALL ON FUNCTION public.consumir_analise_por(uuid)    FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.consumir_documental_por(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_analise_por(uuid)    TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_documental_por(uuid) TO service_role;
