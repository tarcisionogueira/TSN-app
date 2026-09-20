-- Cota de análise de VEÍCULO (21/09, pedido do dono: "modelar a estrutura que temos em cima
-- da busca de imóveis para os veículos"). Espelha o balde MERCADOLÓGICO de imóvel — é o mesmo
-- conceito ("gerar 1 relatório de IA para este lote"), só que para `veiculos_leilao`, e com
-- UM relatório por veículo (não dois como imóvel) — por isso só existe 1 balde 'veiculo', não
-- um par mercado/documental.
--
-- Limites: espelha 1:1 os números vigentes do balde mercadológico (explorador 3 vitalício,
-- consultor 5/mês, top2/assessorado/clube 10/mês, equipe 100/mês, admin ∞) — é a mesma
-- "unidade de relatório de IA" que o cliente já entende, sem inventar uma tabela de preço nova
-- para o piloto. Ajustável depois só mudando `limite_ia`, sem tocar em código.

alter table public.perfis add column if not exists veiculo_count int not null default 0;
alter table public.perfis add column if not exists veiculo_mes   text;
alter table public.perfis add column if not exists bonus_veiculo int not null default 0;

-- 1) Fonte única dos limites, agora com 'veiculo' (mesmos números do balde 'mercado').
create or replace function public.limite_ia(p_role text, p_tipo text)
returns integer language sql immutable as $function$
  select case
    when p_role = 'admin' then null::int
    when p_tipo = 'indice' then case p_role
      when 'top2' then 3 when 'top2_anual' then 3
      when 'assessorado' then 3 when 'assessorado_anual' then 3
      when 'clube' then 3 when 'clube_anual' then 3
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'documental' then case p_role
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'veiculo' then case p_role                       -- NOVO: mesmo balde do mercadológico
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
    else case p_role                                                -- mercadológico (imóvel)
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
  end
$function$;

-- 2) Limite efetivo por usuário — grandfather (15/15/5) NÃO cobre 'veiculo' (feature nova,
--    ninguém tinha direito adquirido a ela); cai direto em limite_ia.
create or replace function public.limite_ia_efetivo(p_user_id uuid, p_tipo text)
returns integer language sql stable security definer set search_path to 'public' as $function$
  select case
    when p.role = 'admin' then null::int
    when p.plano_legado and p_tipo <> 'veiculo'
         and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then case p_tipo when 'indice' then 5 else 15 end
    else public.limite_ia(p.role, p_tipo)
  end
  from public.perfis p where p.id = p_user_id
$function$;

-- 3) Contagem REAL (deriva do conteúdo, mesmo princípio de `analises_usadas_mes` para imóvel —
--    ver cotas_derivam_do_real.sql). Sem isto, on-behalf/cron/estorno derrapariam o contador
--    aqui do mesmo jeito que derraparam em analises_mercado antes da correção de 21/08.
create or replace function public.analises_veiculo_usadas_mes(p_user_id uuid, p_desde timestamptz)
returns int language sql stable security definer set search_path to 'public' as $function$
  select coalesce((
    select count(distinct veiculo_id) from public.analises_veiculo
     where user_id = p_user_id and status = 'concluida'
       and (p_desde is null or created_at >= p_desde)
       and coalesce(btrim(result->>'parecer'),'') <> ''), 0)
$function$;
revoke all on function public.analises_veiculo_usadas_mes(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.analises_veiculo_usadas_mes(uuid, timestamptz) to service_role;

-- 4) Consumo (enforcement) — mesmo padrão de consumir_analise_por, com ramo 'amostra' vitalícia
--    para o explorador (reaproveita amostra_mercado_usadas? NÃO — é um contador PRÓPRIO, senão
--    gerar 1 relatório de imóvel e 1 de veículo consumiria a MESMA amostra de 3, quando o dono
--    pediu os dois como funcionalidades distintas).
alter table public.perfis add column if not exists amostra_veiculo_usadas int not null default 0;

create or replace function public.consumir_veiculo_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  v_role text; v_limite int; v_count int; v_mes text; v_bonus int;
  v_mes_atual text := to_char(now(),'YYYY-MM');
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  SELECT role, coalesce(veiculo_count,0), veiculo_mes, coalesce(bonus_veiculo,0)
    INTO v_role, v_count, v_mes, v_bonus FROM perfis WHERE id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'veiculo');
  IF v_limite IS NULL THEN RETURN jsonb_build_object('ok',true,'ilimitado',true); END IF;
  IF v_role = 'explorador' THEN
    SELECT coalesce(amostra_veiculo_usadas,0) INTO v_count FROM perfis WHERE id = p_user_id;
    v_count := greatest(v_count, analises_veiculo_usadas_mes(p_user_id, null));
    IF v_count < v_limite THEN
      UPDATE perfis SET amostra_veiculo_usadas = greatest(coalesce(amostra_veiculo_usadas,0), v_count) + 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','amostra','usadas',v_count+1,'limite',v_limite);
    END IF;
    IF v_bonus > 0 THEN
      UPDATE perfis SET bonus_veiculo = v_bonus - 1 WHERE id = p_user_id;
      RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
    END IF;
    RETURN jsonb_build_object('ok',false,'erro','amostra_esgotada','usadas',v_count,'limite',v_limite);
  END IF;
  IF v_mes IS DISTINCT FROM v_mes_atual THEN v_count := 0; END IF;
  v_count := greatest(v_count, analises_veiculo_usadas_mes(p_user_id, date_trunc('month', now())));
  IF v_count < v_limite THEN
    UPDATE perfis SET veiculo_count = v_count + 1, veiculo_mes = v_mes_atual WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  END IF;
  IF v_bonus > 0 THEN
    UPDATE perfis SET bonus_veiculo = v_bonus - 1 WHERE id = p_user_id;
    RETURN jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
  END IF;
  RETURN jsonb_build_object('ok',false,'erro','limite_mensal','usadas',v_count,'limite',v_limite);
END; $function$;

create or replace function public.estornar_veiculo_por(p_user_id uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if p_tipo = 'bonus' then
    update perfis set bonus_veiculo = coalesce(bonus_veiculo,0) + 1 where id = p_user_id;
  elsif p_tipo = 'amostra' then
    update perfis set amostra_veiculo_usadas = greatest(coalesce(amostra_veiculo_usadas,0) - 1, 0) where id = p_user_id;
  elsif p_tipo = 'mensal' then
    update perfis set veiculo_count = greatest(coalesce(veiculo_count,0) - 1, 0)
      where id = p_user_id and veiculo_mes = to_char(now(),'YYYY-MM');
  end if;
end; $$;

revoke all on function public.consumir_veiculo_por(uuid) from public, anon, authenticated;
revoke all on function public.estornar_veiculo_por(uuid, text) from public, anon, authenticated;
grant execute on function public.consumir_veiculo_por(uuid) to service_role;
grant execute on function public.estornar_veiculo_por(uuid, text) to service_role;

-- 5) DISPLAY: minhas_cotas ganha o bloco 'veiculo' (mesmo padrão usado>=greatest(contador,real)).
create or replace function public.minhas_cotas(p_user_id uuid)
 returns jsonb
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_p record; v_mes text := to_char(now(),'YYYY-MM'); v_caller text;
  v_lm int; v_ld int; v_li int; v_lv int; v_um int; v_ud int; v_ui int; v_uv int; v_amostra boolean := false;
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
         coalesce(veiculo_count,0) vc, veiculo_mes vm,
         coalesce(bonus_mercado,0) bm, coalesce(bonus_documental,0) bd, coalesce(bonus_indice,0) bi,
         coalesce(bonus_veiculo,0) bv,
         coalesce(credito_saldo,0) saldo, coalesce(amostra_mercado_usadas,0) amu,
         coalesce(amostra_veiculo_usadas,0) avu
    into v_p from perfis where id = p_user_id;
  if v_p is null then return jsonb_build_object('erro','sem_perfil'); end if;
  v_lm := limite_ia_efetivo(p_user_id,'mercado');
  v_ld := limite_ia_efetivo(p_user_id,'documental');
  v_li := limite_ia_efetivo(p_user_id,'indice');
  v_lv := limite_ia_efetivo(p_user_id,'veiculo');
  if v_p.role = 'explorador' then
    v_um := greatest(v_p.amu, analises_usadas_mes(p_user_id,'mercado', null));
    v_uv := greatest(v_p.avu, analises_veiculo_usadas_mes(p_user_id, null));
    v_amostra := true;
  else
    v_um := greatest(case when v_p.am = v_mes then v_p.ac else 0 end,
                     analises_usadas_mes(p_user_id,'mercado', date_trunc('month', now())));
    v_uv := greatest(case when v_p.vm = v_mes then v_p.vc else 0 end,
                     analises_veiculo_usadas_mes(p_user_id, date_trunc('month', now())));
  end if;
  v_ud := greatest(case when v_p.dm = v_mes then v_p.dc else 0 end,
                   analises_usadas_mes(p_user_id,'documental', date_trunc('month', now())));
  v_ui := case when v_p.im = v_mes then v_p.ic else 0 end;
  return jsonb_build_object(
    'plano', v_p.plano, 'role', v_p.role, 'mes', v_mes, 'amostra', v_amostra,
    'mercado',    jsonb_build_object('usado',v_um,'limite',v_lm,'bonus',v_p.bm,'ilimitado',(v_lm is null),'amostra',v_amostra),
    'documental', jsonb_build_object('usado',v_ud,'limite',v_ld,'bonus',v_p.bd,'ilimitado',(v_ld is null)),
    'indice',     jsonb_build_object('usado',v_ui,'limite',v_li,'bonus',v_p.bi,'ilimitado',(v_li is null)),
    'veiculo',    jsonb_build_object('usado',v_uv,'limite',v_lv,'bonus',v_p.bv,'ilimitado',(v_lv is null),'amostra',v_amostra),
    'credito_saldo', v_p.saldo);
end; $function$;
