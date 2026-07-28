-- Plano EXPLORADOR (grátis): os 3 relatórios mercadológicos passam a ser uma AMOSTRA VITALÍCIA
-- (total, não renovável por mês). Antes, consumir_analise_por resetava o contador todo mês
-- (analises_count/analises_mes) → o Explorador ganhava 3 relatórios novos a cada mês. Regra do
-- dono: "não mais por mês; acabou os 3, compra crédito". Contador DEDICADO (amostra_mercado_usadas)
-- para não misturar com a cota MENSAL dos planos pagos e sobreviver a upgrade/downgrade. Default 0
-- perdoa o histórico (todo Explorador atual recomeça com 3 de amostra — generoso e sem surpresas).
alter table public.perfis add column if not exists amostra_mercado_usadas int not null default 0;

-- Consome 1 relatório mercadológico. EXPLORADOR usa a amostra vitalícia; demais planos, a cota mensal.
create or replace function public.consumir_analise_por(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_limite int; v_count int; v_mes text; v_bonus int; v_role text;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT role, coalesce(analises_count,0), analises_mes, coalesce(bonus_mercado,0)
    INTO v_role, v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'mercado');
  IF v_limite IS NULL THEN RETURN jsonb_build_object('ok',true,'ilimitado',true); END IF;

  -- EXPLORADOR: AMOSTRA VITALÍCIA (não reseta por mês). Ao esgotar, o chamador tenta CRÉDITO (compra).
  IF v_role = 'explorador' THEN
    SELECT coalesce(amostra_mercado_usadas,0) INTO v_count FROM perfis WHERE id = p_user_id;
    IF v_count < v_limite THEN
      UPDATE perfis SET amostra_mercado_usadas = v_count + 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','amostra','usadas',v_count+1,'limite',v_limite);
    END IF;
    IF v_bonus > 0 THEN
      UPDATE perfis SET bonus_mercado = v_bonus - 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
    END IF;
    RETURN jsonb_build_object('ok',false,'erro','amostra_esgotada','usadas',v_count,'limite',v_limite);
  END IF;

  -- Demais planos: cota MENSAL (reseta a cada mês).
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
END; $function$;

-- Estorno (relatório que não entregou → devolve à pool). Agora entende também o tipo 'amostra'.
create or replace function public.estornar_analise_por(p_user_id uuid, p_tipo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_user_id is null then return; end if;
  if p_tipo = 'bonus' then
    update perfis set bonus_mercado = coalesce(bonus_mercado,0) + 1 where id = p_user_id;
  elsif p_tipo = 'amostra' then
    update perfis set amostra_mercado_usadas = greatest(coalesce(amostra_mercado_usadas,0) - 1, 0) where id = p_user_id;
  elsif p_tipo = 'mensal' then
    update perfis set analises_count = greatest(coalesce(analises_count,0) - 1, 0)
      where id = p_user_id and analises_mes = to_char(now(),'YYYY-MM');
  end if;
end; $function$;
