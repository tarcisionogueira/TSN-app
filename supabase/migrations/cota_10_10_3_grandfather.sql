-- PASSO 1 do novo modelo de cobrança — nova cota dos planos pagos + grandfather.
--
-- Planos pagos (Investidor Pro / Assessorado / Leilão Club, e as variações _anual) passam
-- de 15+15+5 para **10 mercadológico + 10 documental + 3 índice de mercado** por mês. Os
-- assinantes ATUAIS (4 hoje) são marcados como `plano_legado` e MANTÊM 15+15+5 (grandfather).
-- Novos assinantes nascem na cota nova. explorador/consultor/analista/advogado inalterados.
--
-- Regra de negócio combinada com o dono: quem cancela vira explorador (não apaga conta);
-- ao reassinar, entra SEM o grandfather (paga/recebe a cota do dia). Por isso o legado é um
-- flag explícito, não derivado do papel.

-- 1) Flag de grandfather.
alter table public.perfis add column if not exists plano_legado boolean not null default false;

-- 2) Marca os pagos ATUAIS como legado (idempotente; novos nascem false).
update public.perfis
set plano_legado = true
where role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
  and plano_legado = false;

-- 3) Base de cota NOVA (pagos 10/10/3). Mantém explorador(3 merc / 0 doc / 0 índice),
--    consultor(5/0/0) e equipe(100).
create or replace function public.limite_ia(p_role text, p_tipo text)
returns integer language sql immutable as $function$
  select case
    when p_role = 'admin' then null::int
    when p_tipo = 'indice' then case p_role
      when 'top2' then 3 when 'top2_anual' then 3
      when 'assessorado' then 3 when 'assessorado_anual' then 3
      when 'clube' then 3 when 'clube_anual' then 3
      when 'analista' then 100 when 'advogado' then 100
      else 0 end                                              -- explorador/consultor: só visualiza
    when p_tipo = 'documental' then case p_role
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    else case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
  end
$function$;

-- 4) Limite EFETIVO por USUÁRIO — ponto único de grandfather: o legado mantém 15/15/5;
--    o resto usa a base nova. Usado pelas RPCs de consumo e pelo pré-cheque do índice.
create or replace function public.limite_ia_efetivo(p_user_id uuid, p_tipo text)
returns integer language sql stable security definer set search_path to 'public' as $function$
  select case
    when p.role = 'admin' then null::int
    when p.plano_legado
         and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then case p_tipo when 'indice' then 5 else 15 end        -- grandfather: cota antiga
    else public.limite_ia(p.role, p_tipo)
  end
  from public.perfis p where p.id = p_user_id
$function$;

-- 5) RPCs de consumo passam a usar o limite EFETIVO (respeita o grandfather). Fora a linha
--    do limite, a lógica é a mesma de antes (reset mensal + bônus + incremento atômico).
create or replace function public.consumir_analise_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_limite int; v_count int; v_mes text; v_bonus int;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT coalesce(analises_count,0), analises_mes, coalesce(bonus_mercado,0)
    INTO v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'mercado');
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
END; $function$;

create or replace function public.consumir_documental_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

create or replace function public.consumir_indice_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_limite int; v_count int; v_mes text; v_mes_atual text := to_char(now(),'YYYY-MM');
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','nao_autenticado'); end if;
  select coalesce(indice_count,0), indice_mes into v_count, v_mes from perfis where id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'indice');
  if v_limite is null then return jsonb_build_object('ok',true,'ilimitado',true); end if;
  if v_mes is distinct from v_mes_atual then v_count := 0; end if;
  if v_count < v_limite then
    update perfis set indice_count = v_count + 1, indice_mes = v_mes_atual where id = p_user_id;
    return jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  end if;
  return jsonb_build_object('ok',false,
    'erro', case when v_limite = 0 then 'sem_indice' else 'limite_mensal' end,
    'usadas',v_count,'limite',v_limite);
end; $function$;
