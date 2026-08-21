-- =====================================================================================
-- CONTAGEM DE RELATÓRIOS: DERIVA DO REAL, NÃO DE UM CONTADOR QUE DERRAPA (21/08)
--
-- Achado do dono: o Marcelo (top2, 2 relatórios gerados) via "10 de 10 análises disponíveis" —
-- deveria ver "8 de 10". Causa: o "usado" vinha de `perfis.analises_count`, um contador que só
-- `consumir_analise_por` incrementa — e que NÃO roda quando o relatório é gerado no modo SUPORTE
-- (on-behalf) nem por cron. Os 2 relatórios do Marcelo foram on-behalf → contador 0 → "10 de 10".
-- O mesmo contador derrapa em: estorno, virada de mês, qualquer bug de cobrança.
--
-- Conserto (self-correcting, "não pode falhar"): `usado = GREATEST(contador, real)`.
--   · REAL = relatórios que o cliente REALMENTE tem, por CONTEÚDO atual (concluída, com valor de
--     mercado e com parecer), distinto por imóvel — espelha o `isNovo` da cobrança. Sobe o
--     contador quando ele ficou abaixo da realidade (on-behalf/cron).
--   · CONTADOR = PISO: cobrança é permanente, então apagar o relatório NÃO devolve a vaga (anti-abuso).
-- Vale no DISPLAY (minhas_cotas) e no ENFORCEMENT (consumir_*_por), então os dois nunca divergem.
-- Todas as telas leem via minhas_cotas (lerCotas/lerCotaMercado) → correção única cobre todas.
-- Índice fica no contador (cobra-no-sucesso, não tem drift de on-behalf).
-- =====================================================================================

-- Helper: conta os relatórios REAIS por conteúdo. p_desde nulo = desde sempre (amostra vitalícia).
create or replace function public.analises_usadas_mes(p_user_id uuid, p_tipo text, p_desde timestamptz)
returns int
language sql stable security definer set search_path to 'public'
as $function$
  select case p_tipo
    when 'mercado' then coalesce((
      select count(distinct imovel_id) from analises_mercado
       where user_id = p_user_id and status = 'concluida'
         and (p_desde is null or created_at >= p_desde)
         and coalesce(result->>'mercadoVazio','') <> 'true'
         and coalesce(btrim(result->>'parecer'),'') <> ''), 0)
    when 'documental' then coalesce((
      select count(distinct imovel_id) from analises_documental
       where user_id = p_user_id and status = 'concluida'
         and (p_desde is null or created_at >= p_desde)
         and coalesce(result->>'precisaDocumentos','') <> 'true'
         and coalesce(btrim(result->>'parecer'),'') <> ''), 0)
    else 0
  end;
$function$;
revoke all on function public.analises_usadas_mes(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.analises_usadas_mes(uuid, text, timestamptz) to service_role;

-- DISPLAY: usado = greatest(contador, real).
create or replace function public.minhas_cotas(p_user_id uuid)
 returns jsonb
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_p record; v_mes text := to_char(now(),'YYYY-MM'); v_caller text;
  v_lm int; v_ld int; v_li int; v_um int; v_ud int; v_ui int; v_amostra boolean := false;
begin
  if auth.uid() is null then return jsonb_build_object('erro','nao_autenticado'); end if;
  if auth.uid() <> p_user_id then
    select role into v_caller from perfis where id = auth.uid();
    if v_caller is null or v_caller not in ('admin','analista') then
      return jsonb_build_object('erro','sem_permissao');
    end if;
  end if;
  select role, plano,
         coalesce(analises_count,0) ac, analises_mes am,
         coalesce(documental_count,0) dc, documental_mes dm,
         coalesce(indice_count,0) ic, indice_mes im,
         coalesce(bonus_mercado,0) bm, coalesce(bonus_documental,0) bd, coalesce(bonus_indice,0) bi,
         coalesce(credito_saldo,0) saldo, coalesce(amostra_mercado_usadas,0) amu
    into v_p from perfis where id = p_user_id;
  if v_p is null then return jsonb_build_object('erro','sem_perfil'); end if;
  v_lm := limite_ia_efetivo(p_user_id,'mercado');
  v_ld := limite_ia_efetivo(p_user_id,'documental');
  v_li := limite_ia_efetivo(p_user_id,'indice');
  if v_p.role = 'explorador' then
    v_um := greatest(v_p.amu, analises_usadas_mes(p_user_id,'mercado', null));
    v_amostra := true;
  else
    v_um := greatest(case when v_p.am = v_mes then v_p.ac else 0 end,
                     analises_usadas_mes(p_user_id,'mercado', date_trunc('month', now())));
  end if;
  v_ud := greatest(case when v_p.dm = v_mes then v_p.dc else 0 end,
                   analises_usadas_mes(p_user_id,'documental', date_trunc('month', now())));
  v_ui := case when v_p.im = v_mes then v_p.ic else 0 end;
  return jsonb_build_object(
    'plano', v_p.plano, 'role', v_p.role, 'mes', v_mes, 'amostra', v_amostra,
    'mercado',    jsonb_build_object('usado',v_um,'limite',v_lm,'bonus',v_p.bm,'ilimitado',(v_lm is null),'amostra',v_amostra),
    'documental', jsonb_build_object('usado',v_ud,'limite',v_ld,'bonus',v_p.bd,'ilimitado',(v_ld is null)),
    'indice',     jsonb_build_object('usado',v_ui,'limite',v_li,'bonus',v_p.bi,'ilimitado',(v_li is null)),
    'credito_saldo', v_p.saldo);
end; $function$;

-- ENFORCEMENT mercado: reconcilia (greatest só sobe — nunca bloqueia quem tem direito).
create or replace function public.consumir_analise_por(p_user_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
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
  IF v_role = 'explorador' THEN
    SELECT coalesce(amostra_mercado_usadas,0) INTO v_count FROM perfis WHERE id = p_user_id;
    v_count := greatest(v_count, analises_usadas_mes(p_user_id,'mercado', null));
    IF v_count < v_limite THEN
      UPDATE perfis SET amostra_mercado_usadas = greatest(coalesce(amostra_mercado_usadas,0), v_count) + 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','amostra','usadas',v_count+1,'limite',v_limite);
    END IF;
    IF v_bonus > 0 THEN
      UPDATE perfis SET bonus_mercado = v_bonus - 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
    END IF;
    RETURN jsonb_build_object('ok',false,'erro','amostra_esgotada','usadas',v_count,'limite',v_limite);
  END IF;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  v_count := greatest(v_count, analises_usadas_mes(p_user_id,'mercado', date_trunc('month', now())));
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

-- ENFORCEMENT documental: mesma reconciliação.
create or replace function public.consumir_documental_por(p_user_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_limite int; v_count int; v_mes text; v_bonus int;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT coalesce(documental_count,0), documental_mes, coalesce(bonus_documental,0)
    INTO v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'documental');
  IF v_limite IS NULL THEN RETURN jsonb_build_object('ok',true,'ilimitado',true); END IF;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  v_count := greatest(v_count, analises_usadas_mes(p_user_id,'documental', date_trunc('month', now())));
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
END; $function$;
