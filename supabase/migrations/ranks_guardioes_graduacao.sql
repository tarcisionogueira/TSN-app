-- ── HIERARQUIA "GUARDIÕES": graduação por DUPLICAÇÃO (modelo do Clube Conselheiro) ──────
-- Antes o rank subia só CONTANDO pagantes (N diretos + N rede) — o dono apontou que isso
-- está errado: tem que exigir GRADUAÇÕES abaixo (formar líderes). Agora cada nível exige
-- N indicados DIRETOS que ELES MESMOS atingiram o nível anterior (duplicação), em linhas
-- diretas distintas. Topo (Guardião/Patrono/Lenda) = líderes + bônus infinito + pool.
--
-- Níveis: Pioneiro→Fundador→Mestre→Mentor→Embaixador→Guardião→Patrono→Lenda.
-- req_sub_ordem = ordem do rank exigido em cada indicado direto (0 = indicado pagante ativo).

alter table public.comissao_ranks
  add column if not exists req_pernas int default 0,
  add column if not exists req_sub_ordem int default 0,
  add column if not exists bonus_infinito_pct numeric default 0;

-- Upsert (não deletar: perfis.rank_key tem FK). r1..r5 = construção; r6..r8 = liderança.
insert into public.comissao_ranks (rank_key, ordem, nome, min_diretos_pagantes, min_rede_pagante, pool_peso, bonus_fixo, ativo, max_nivel, req_pernas, req_sub_ordem, bonus_infinito_pct) values
 ('r1',1,'Pioneiro',   0,0,0,0,true,1, 1,0,0),
 ('r2',2,'Fundador',   0,0,0,0,true,2, 2,1,0),
 ('r3',3,'Mestre',     0,0,0,0,true,3, 2,2,0),
 ('r4',4,'Mentor',     0,0,0,0,true,4, 2,3,0),
 ('r5',5,'Embaixador', 0,0,0,0,true,5, 3,4,0),
 ('r6',6,'Guardião',   0,0,1,0,true,5, 5,5,0.5),
 ('r7',7,'Patrono',    0,0,2,0,true,5, 2,6,1.0),
 ('r8',8,'Lenda',      0,0,3,0,true,5, 3,7,1.5)
on conflict (rank_key) do update set
  ordem=excluded.ordem, nome=excluded.nome, pool_peso=excluded.pool_peso, ativo=excluded.ativo,
  max_nivel=excluded.max_nivel, req_pernas=excluded.req_pernas, req_sub_ordem=excluded.req_sub_ordem,
  bonus_infinito_pct=excluded.bonus_infinito_pct, min_diretos_pagantes=excluded.min_diretos_pagantes,
  min_rede_pagante=excluded.min_rede_pagante;

-- Rank VIVO pelos indicados DIRETOS já graduados (lê rank_key dos filhos).
create or replace function public.rank_do_parceiro(p_uid uuid)
 returns text language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_pd int; r record;
begin
  if not public.eh_pagante((select role from perfis where id = p_uid)) then return null; end if;
  select count(*) into v_pd from perfis c where c.indicado_por = p_uid and public.eh_pagante(c.role);
  for r in select rank_key, ordem, req_pernas, req_sub_ordem from public.comissao_ranks where ativo order by ordem desc loop
    if r.ordem = 1 then
      if v_pd >= 1 then return r.rank_key; end if;
    else
      if (select count(*) from perfis c join public.comissao_ranks cr on cr.rank_key = c.rank_key
            where c.indicado_por = p_uid and cr.ordem >= r.req_sub_ordem) >= r.req_pernas
      then return r.rank_key; end if;
    end if;
  end loop;
  return null;
end; $function$;

-- Recalcula todos: FIXPOINT bottom-up (o rank de cada um depende dos filhos) + carência de queda.
create or replace function public.recalcular_ranks()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_caren int; v_n int := 0; v_changed int; r record; v_no int; v_ao int;
begin
  select meses_carencia_queda into v_caren from public.rank_config where id = 1;
  update public.perfis set rank_key = null, rank_meses_abaixo = 0, rank_desde = null
   where rank_key is not null and not public.eh_pagante(role);

  create temp table _prev on commit drop as
    select id, rank_key as prev_rank, coalesce(rank_meses_abaixo,0) as mab
    from public.perfis where public.eh_pagante(role);

  update public.perfis set rank_key = null where public.eh_pagante(role);
  for i in 1..15 loop
    with upd as (
      update public.perfis p set rank_key = public.rank_do_parceiro(p.id)
      where public.eh_pagante(p.role) and p.rank_key is distinct from public.rank_do_parceiro(p.id)
      returning 1
    ) select count(*) into v_changed from upd;
    exit when v_changed = 0;
  end loop;

  for r in select p.id, p.rank_key as novo, pv.prev_rank, pv.mab
           from public.perfis p join _prev pv on pv.id = p.id loop
    v_n := v_n + 1;
    v_no := coalesce((select ordem from public.comissao_ranks where rank_key = r.novo),0);
    v_ao := coalesce((select ordem from public.comissao_ranks where rank_key = r.prev_rank),0);
    if v_no >= v_ao then
      update public.perfis set rank_meses_abaixo = 0,
        rank_desde = case when r.prev_rank is distinct from r.novo then now() else rank_desde end
      where id = r.id;
    elsif r.mab + 1 >= v_caren then
      update public.perfis set rank_meses_abaixo = 0, rank_desde = now() where id = r.id;
    else
      update public.perfis set rank_key = r.prev_rank, rank_meses_abaixo = r.mab + 1 where id = r.id;
    end if;
  end loop;
  return v_n;
end; $function$;

-- meu_nivel: rank OFICIAL (stored) + progresso por GRADUAÇÃO (quantos <rank anterior> na rede direta).
create or replace function public.meu_nivel()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_rank text; v_ord int; v_indic numeric;
        v_prox record; v_pd int; v_tem int; v_sub_nome text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'erro', 'sem_sessao'); end if;
  select role, rank_key into v_role, v_rank from perfis where id = v_uid;
  select comissao_indicacao_pct into v_indic from rank_config where id = 1;
  select ordem into v_ord from comissao_ranks where rank_key = v_rank;
  v_ord := coalesce(v_ord, 0);
  select count(*) into v_pd from perfis c where c.indicado_por = v_uid and eh_pagante(c.role);
  select * into v_prox from comissao_ranks where ativo and ordem > v_ord order by ordem asc limit 1;

  if v_prox.rank_key is not null then
    if v_prox.ordem = 1 then
      v_tem := v_pd; v_sub_nome := 'indicado pagante ativo';
    else
      select count(*) into v_tem from perfis c join comissao_ranks cr on cr.rank_key = c.rank_key
        where c.indicado_por = v_uid and cr.ordem >= v_prox.req_sub_ordem;
      select nome into v_sub_nome from comissao_ranks where ordem = v_prox.req_sub_ordem;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'tem_rank', v_rank is not null, 'comissao_indicacao_pct', coalesce(v_indic, 25),
    'diretos_pagantes', coalesce(v_pd,0),
    'rank_atual', (select jsonb_build_object('nome',nome,'ordem',ordem,'max_nivel',max_nivel,'bonus_infinito_pct',coalesce(bonus_infinito_pct,0)) from comissao_ranks where rank_key = v_rank),
    'proximo', (case when v_prox.rank_key is null then null else jsonb_build_object(
        'nome', v_prox.nome, 'req_pernas', v_prox.req_pernas, 'sub_nome', v_sub_nome,
        'tem', coalesce(v_tem,0), 'faltam', greatest(v_prox.req_pernas - coalesce(v_tem,0), 0),
        'bonus_infinito_pct', coalesce(v_prox.bonus_infinito_pct,0)) end),
    'trilha', (select jsonb_agg(jsonb_build_object('nome',nome,'atingido', ordem <= v_ord) order by ordem) from comissao_ranks where ativo)
  );
end; $function$;

-- Recomputa uma vez ao aplicar (idempotente).
select public.recalcular_ranks();
