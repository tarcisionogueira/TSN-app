-- ════════════════════════════════════════════════════════════════════════════
-- Equipe (analista/advogado) NÃO gera relatórios — apenas recebe/visualiza demandas.
-- Redefine limite_ia para dar limite 0 de geração a analista/advogado.
-- Admin segue ilimitado. Complementa cotas_ia_por_plano.sql (rode depois dele).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.limite_ia(p_role text, p_tipo text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_role = 'admin' THEN NULL::int
    WHEN p_role IN ('analista','advogado') THEN 0
    WHEN p_tipo = 'documental' THEN CASE p_role
      WHEN 'top2' THEN 15 WHEN 'top2_anual' THEN 15
      WHEN 'assessorado' THEN 15 WHEN 'assessorado_anual' THEN 15
      WHEN 'clube' THEN 15 WHEN 'clube_anual' THEN 15
      ELSE 0 END
    ELSE CASE p_role
      WHEN 'explorador' THEN 5 WHEN 'consultor' THEN 5
      WHEN 'top2' THEN 15 WHEN 'top2_anual' THEN 15
      WHEN 'assessorado' THEN 15 WHEN 'assessorado_anual' THEN 15
      WHEN 'clube' THEN 15 WHEN 'clube_anual' THEN 15
      ELSE 5 END
  END
$$;
