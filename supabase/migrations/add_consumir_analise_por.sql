-- ⚠️ SUPERSEDED por cotas_ia_por_plano.sql — NÃO RODE ISOLADAMENTE.
-- Esta versão de consumir_analise_por() usa o MODELO ANTIGO (assessorado/clube
-- ilimitados, sem variantes _anual, sem limite_ia). A migration cotas_ia_por_plano.sql
-- redefine a função para o modelo vigente (fonte única limite_ia). Num apply completo,
-- cotas_ia_por_plano.sql roda depois e prevalece; mas rodar SÓ este arquivo REVERTERIA
-- a cota. Mantido apenas como registro histórico.
-- ════════════════════════════════════════════════════════════════════════════
-- Cota de análises consumida NO SERVIDOR (anti-abuso de custo de IA)
-- Rodar no SQL Editor do Supabase. Aditivo e idempotente.
--
-- Espelho EXATO de consumir_analise() (que usa auth.uid()), mas recebe o
-- user_id por parâmetro para ser chamada pelo backend (/api/gerar-analise)
-- com a service_role — o edge já autenticou o usuário via getUser(req).
-- Assim a cota é aplicada onde o custo realmente ocorre (na geração), e não
-- só no cliente (que podia ser burlado chamando a API direto).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.consumir_analise_por(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := p_user_id;
  v_role text;
  v_bonus int;
  v_count int;
  v_mes text;
  v_mes_atual text := to_char(now(), 'YYYY-MM');
  v_limite int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;

  SELECT role, coalesce(bonus_mercado, 0), coalesce(analises_count, 0), analises_mes
    INTO v_role, v_bonus, v_count, v_mes
    FROM perfis WHERE id = v_uid;

  -- Planos sem limite
  IF v_role IN ('assessorado','clube','analista','advogado','admin') THEN
    RETURN jsonb_build_object('ok', true, 'ilimitado', true);
  END IF;

  -- Explorador (ou sem perfil): usa bônus
  IF v_role IS NULL OR v_role = 'explorador' THEN
    IF v_bonus <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_credito', 'restante', 0);
    END IF;
    UPDATE perfis SET bonus_mercado = v_bonus - 1 WHERE id = v_uid;
    RETURN jsonb_build_object('ok', true, 'tipo', 'bonus', 'restante', v_bonus - 1);
  END IF;

  -- Planos com limite mensal (top2 = 15)
  v_limite := CASE v_role WHEN 'top2' THEN 15 ELSE 0 END;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  IF v_count >= v_limite THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite_mensal', 'usadas', v_count, 'limite', v_limite);
  END IF;
  UPDATE perfis SET analises_count = v_count + 1, analises_mes = v_mes_atual WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true, 'tipo', 'mensal', 'usadas', v_count + 1, 'limite', v_limite);
END;
$$;

-- Só o servidor (service_role) chama; nunca exposto ao cliente.
REVOKE ALL ON FUNCTION public.consumir_analise_por(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_analise_por(uuid) TO service_role;
