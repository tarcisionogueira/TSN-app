-- Modo suporte: conceder consultas extras sem o assinante colocar crédito (#20)
-- + resumo de cotas/saldo p/ a tela de créditos do usuário (#21).
--
-- Mecanismo: o BÔNUS já é consumido DEPOIS da cota mensal do plano (ver consumir_*_por),
-- então conceder bônus = dar consultas extras que não custam nada ao assinante. mercado e
-- documental já tinham coluna de bônus; ÍNDICE não — criamos bonus_indice e passamos o
-- consumir_indice_por a usá-lo (mesmo padrão dos outros dois). Toda concessão fica registrada
-- em cota_concessoes (transparência: o cliente vê "bônus concedido pela equipe" na tela dele).

-- 1) Coluna de bônus do índice (paridade com bonus_mercado / bonus_documental).
alter table public.perfis add column if not exists bonus_indice int not null default 0;

-- 2) consumir_indice_por passa a consumir bonus_indice após esgotar a cota mensal.
create or replace function public.consumir_indice_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_limite int; v_count int; v_mes text; v_bonus int; v_mes_atual text := to_char(now(),'YYYY-MM');
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','nao_autenticado'); end if;
  select coalesce(indice_count,0), indice_mes, coalesce(bonus_indice,0)
    into v_count, v_mes, v_bonus from perfis where id = p_user_id;
  v_limite := limite_ia_efetivo(p_user_id, 'indice');
  if v_limite is null then return jsonb_build_object('ok',true,'ilimitado',true); end if;
  if v_mes is distinct from v_mes_atual then v_count := 0; end if;
  if v_count < v_limite then
    update perfis set indice_count = v_count + 1, indice_mes = v_mes_atual where id = p_user_id;
    return jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  end if;
  if v_bonus > 0 then
    update perfis set bonus_indice = v_bonus - 1 where id = p_user_id;
    return jsonb_build_object('ok',true,'tipo','bonus','restante',v_bonus-1,'limite',v_limite);
  end if;
  return jsonb_build_object('ok',false,
    'erro', case when v_limite = 0 then 'sem_indice' else 'limite_mensal' end,
    'usadas',v_count,'limite',v_limite);
end; $function$;

-- 3) Registro das concessões (auditoria + transparência p/ o cliente).
create table if not exists public.cota_concessoes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis(id) on delete cascade,
  mercado int not null default 0,
  documental int not null default 0,
  indice int not null default 0,
  motivo text,
  concedido_por uuid references public.perfis(id),
  criado_em timestamptz not null default now()
);
create index if not exists idx_cota_concessoes_user on public.cota_concessoes(user_id, criado_em desc);

alter table public.cota_concessoes enable row level security;
-- O cliente vê as próprias concessões; admin/analista veem todas. Sem policy de INSERT:
-- só a RPC SECURITY DEFINER grava (impede um cliente de "se conceder" bônus).
drop policy if exists cota_concessoes_self on public.cota_concessoes;
create policy cota_concessoes_self on public.cota_concessoes for select
  using (auth.uid() = user_id
    or exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista')));

-- 4) RPC de concessão — só admin/analista (checagem interna pelo auth.uid()).
create or replace function public.admin_conceder_cota(
  p_user_id uuid, p_mercado int default 0, p_documental int default 0,
  p_indice int default 0, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_role text; v_m int; v_d int; v_i int; v_bm int; v_bd int; v_bi int;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'erro','nao_autenticado'); end if;
  select role into v_role from perfis where id = auth.uid();
  if v_role is null or v_role not in ('admin','analista') then
    return jsonb_build_object('ok',false,'erro','sem_permissao');
  end if;
  if p_user_id is null or not exists (select 1 from perfis where id = p_user_id) then
    return jsonb_build_object('ok',false,'erro','usuario_invalido');
  end if;
  -- Clamp de sanidade (0..100 por tipo) — evita concessão absurda por engano de digitação.
  v_m := greatest(0, least(100, coalesce(p_mercado,0)));
  v_d := greatest(0, least(100, coalesce(p_documental,0)));
  v_i := greatest(0, least(100, coalesce(p_indice,0)));
  if v_m + v_d + v_i = 0 then return jsonb_build_object('ok',false,'erro','nada_a_conceder'); end if;
  update perfis set
    bonus_mercado    = coalesce(bonus_mercado,0)    + v_m,
    bonus_documental = coalesce(bonus_documental,0) + v_d,
    bonus_indice     = coalesce(bonus_indice,0)     + v_i
  where id = p_user_id
  returning bonus_mercado, bonus_documental, bonus_indice into v_bm, v_bd, v_bi;
  insert into cota_concessoes(user_id, mercado, documental, indice, motivo, concedido_por)
    values (p_user_id, v_m, v_d, v_i, nullif(trim(coalesce(p_motivo,'')),''), auth.uid());
  return jsonb_build_object('ok',true,
    'bonus_mercado',v_bm,'bonus_documental',v_bd,'bonus_indice',v_bi,
    'concedido', jsonb_build_object('mercado',v_m,'documental',v_d,'indice',v_i));
end; $function$;

-- 5) Resumo de cotas/saldo p/ a tela de créditos (o próprio usuário OU admin/analista em suporte).
create or replace function public.minhas_cotas(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_p record; v_mes text := to_char(now(),'YYYY-MM'); v_caller text;
  v_lm int; v_ld int; v_li int; v_um int; v_ud int; v_ui int;
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
         coalesce(credito_saldo,0) saldo
    into v_p from perfis where id = p_user_id;
  if v_p is null then return jsonb_build_object('erro','sem_perfil'); end if;
  v_lm := limite_ia_efetivo(p_user_id,'mercado');
  v_ld := limite_ia_efetivo(p_user_id,'documental');
  v_li := limite_ia_efetivo(p_user_id,'indice');
  v_um := case when v_p.am = v_mes then v_p.ac else 0 end;
  v_ud := case when v_p.dm = v_mes then v_p.dc else 0 end;
  v_ui := case when v_p.im = v_mes then v_p.ic else 0 end;
  return jsonb_build_object(
    'plano', v_p.plano, 'role', v_p.role, 'mes', v_mes,
    'mercado',    jsonb_build_object('usado',v_um,'limite',v_lm,'bonus',v_p.bm,'ilimitado',(v_lm is null)),
    'documental', jsonb_build_object('usado',v_ud,'limite',v_ld,'bonus',v_p.bd,'ilimitado',(v_ld is null)),
    'indice',     jsonb_build_object('usado',v_ui,'limite',v_li,'bonus',v_p.bi,'ilimitado',(v_li is null)),
    'credito_saldo', v_p.saldo);
end; $function$;

-- Exposição: authenticated (nunca anon) — as definer checam permissão internamente.
revoke all on function public.admin_conceder_cota(uuid,int,int,int,text) from anon, public;
revoke all on function public.minhas_cotas(uuid) from anon, public;
grant execute on function public.admin_conceder_cota(uuid,int,int,int,text) to authenticated;
grant execute on function public.minhas_cotas(uuid) to authenticated;
