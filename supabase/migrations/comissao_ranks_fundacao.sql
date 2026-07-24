-- ════════════════════════════════════════════════════════════════════════════
-- PLANO DE CARREIRA / RANKS — FUNDAÇÃO (cálculos + regras prontos, NOME GENÉRICO).
-- O dono ainda vai AMADURECER o nome dos ranks (linha "história + liderança":
-- Pioneiro·Fundador·Mestre·Mentor·Embaixador·Lenda e variações). Até lá, os ranks
-- entram com nome GENÉRICO ("Nível 1..6") — trocar o nome depois é só um UPDATE em
-- comissao_ranks.nome (nenhuma lógica depende do texto). A ESTRUTURA (qualificação,
-- manutenção, bônus de pool fechado) já fica pronta e SAUDÁVEL por definição.
--
-- Saúde: o bônus de rank sai de um POOL FECHADO (% da receita de assinaturas),
-- rateado entre os qualificados por peso — o custo total é limitado por definição,
-- independentemente de quantos batem o rank (nunca estoura a margem).
-- Config-driven: nome, limiares, pesos e % do pool são editáveis sem mexer em código.
-- Estrutura NÃO exposta ao cliente (RLS só service/admin) — "deixar pronta sem divulgar".
-- ════════════════════════════════════════════════════════════════════════════

-- ── Config dos ranks (nome GENÉRICO agora; renomear depois) ──
create table if not exists public.comissao_ranks (
  rank_key text primary key,
  ordem int not null unique,
  nome text not null,                          -- GENÉRICO ("Nível 1") — renomear depois
  min_diretos_pagantes int not null default 0, -- indicados diretos PAGANTES
  min_rede_pagante int not null default 0,     -- total de PAGANTES na rede (todos os níveis)
  pool_peso numeric not null default 0,        -- fatia no pool fechado de reconhecimento
  bonus_fixo numeric not null default 0,       -- bônus fixo mensal (opcional; 0 = só pool)
  ativo boolean not null default true
);

insert into public.comissao_ranks (rank_key, ordem, nome, min_diretos_pagantes, min_rede_pagante, pool_peso) values
  ('r1', 1, 'Nível 1', 0,  0,   0),   -- base: assinatura ativa (sem pool)
  ('r2', 2, 'Nível 2', 3,  3,   1),
  ('r3', 3, 'Nível 3', 5,  10,  2),
  ('r4', 4, 'Nível 4', 10, 30,  4),
  ('r5', 5, 'Nível 5', 20, 100, 8),
  ('r6', 6, 'Nível 6', 40, 300, 16)
on conflict (rank_key) do nothing;

-- ── Config única do pool (% da receita) + carência de queda ──
create table if not exists public.rank_config (
  id int primary key default 1,
  pool_pct numeric not null default 2.0,        -- 2% da receita de assinaturas p/ o pool
  meses_carencia_queda int not null default 2,  -- só cai de rank após N meses abaixo
  check (id = 1)
);
insert into public.rank_config (id) values (1) on conflict do nothing;

-- ── Estado do rank no perfil ──
alter table public.perfis add column if not exists rank_key text references public.comissao_ranks(rank_key);
alter table public.perfis add column if not exists rank_desde timestamptz;
alter table public.perfis add column if not exists rank_meses_abaixo int not null default 0;

-- RLS: estrutura interna (não divulgar). Só service_role/admin acessam.
alter table public.comissao_ranks enable row level security;
alter table public.rank_config   enable row level security;
-- (sem policies p/ anon/authenticated → apenas service_role contorna o RLS)

-- ── Métricas de rede de UM parceiro (diretos pagantes + total pagante na rede) ──
create or replace function public.rede_metricas_parceiro(p_uid uuid)
returns table(diretos_pagantes int, rede_pagante int)
language sql stable security definer set search_path to 'public'
as $function$
  with recursive tree as (
    select c.id, c.role, 1 as nivel
    from perfis c where c.indicado_por = p_uid
    union all
    select c.id, c.role, t.nivel + 1
    from tree t join perfis c on c.indicado_por = t.id
    where t.nivel < 10
  )
  select
    coalesce(count(*) filter (where nivel = 1 and public.eh_pagante(role)), 0)::int,
    coalesce(count(*) filter (where public.eh_pagante(role)), 0)::int
  from tree;
$function$;

-- ── Rank que o parceiro QUALIFICA hoje (maior rank cujos limiares ele atende) ──
create or replace function public.rank_do_parceiro(p_uid uuid)
returns text
language plpgsql stable security definer set search_path to 'public'
as $function$
declare m record; v_rank text;
begin
  if not public.eh_pagante((select role from perfis where id = p_uid)) then
    return null; -- não-pagante não entra no plano de carreira
  end if;
  select * into m from public.rede_metricas_parceiro(p_uid);
  select r.rank_key into v_rank
  from public.comissao_ranks r
  where r.ativo
    and coalesce(m.diretos_pagantes, 0) >= r.min_diretos_pagantes
    and coalesce(m.rede_pagante, 0)     >= r.min_rede_pagante
  order by r.ordem desc
  limit 1;
  return v_rank; -- todo pagante bate ao menos o r1 (limiares 0/0)
end;
$function$;

-- ── Recalcula os ranks (mensal): sobe na hora; só CAI após a carência (não pune
-- oscilação). Retorna quantos perfis foram avaliados. ──
create or replace function public.recalcular_ranks()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_novo text; v_no int; v_ao int; v_caren int; v_n int := 0;
begin
  select meses_carencia_queda into v_caren from public.rank_config where id = 1;

  -- não-pagantes saem do plano (sem rank)
  update public.perfis set rank_key = null, rank_meses_abaixo = 0, rank_desde = null
  where rank_key is not null and not public.eh_pagante(role);

  for r in select id, rank_key, coalesce(rank_meses_abaixo, 0) as mab from public.perfis where public.eh_pagante(role) loop
    v_novo := public.rank_do_parceiro(r.id);
    v_no := coalesce((select ordem from public.comissao_ranks where rank_key = v_novo), 0);
    v_ao := coalesce((select ordem from public.comissao_ranks where rank_key = r.rank_key), 0);
    v_n := v_n + 1;
    if v_no >= v_ao then
      -- subiu ou manteve → aplica já e zera a carência
      update public.perfis set
        rank_key = v_novo,
        rank_meses_abaixo = 0,
        rank_desde = case when rank_key is distinct from v_novo then now() else rank_desde end
      where id = r.id;
    elsif r.mab + 1 >= v_caren then
      -- abaixo por >= carência → efetiva a queda
      update public.perfis set rank_key = v_novo, rank_meses_abaixo = 0, rank_desde = now() where id = r.id;
    else
      -- abaixo, mas dentro da carência → só conta o mês
      update public.perfis set rank_meses_abaixo = r.mab + 1 where id = r.id;
    end if;
  end loop;
  return v_n;
end;
$function$;

-- ── Distribui o POOL FECHADO de reconhecimento de uma competência (ex.: '2026-07').
-- pool = pool_pct% da receita de assinaturas informada, rateado por pool_peso entre os
-- qualificados (rank com pool_peso>0). NUNCA excede o pool. Idempotente por competência.
-- Credita em saldo_lancamentos/comissoes no MESMO padrão de distribuir_comissao_rede. ──
create or replace function public.distribuir_pool_rank(p_competencia text, p_receita_assinaturas numeric)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_pct numeric; v_pool numeric; v_peso_total numeric; rr record; v_val numeric;
        v_n int := 0; v_total numeric := 0; v_oid text;
begin
  if coalesce(p_competencia,'') = '' then return jsonb_build_object('ok', false, 'erro', 'competencia'); end if;
  select pool_pct into v_pct from public.rank_config where id = 1;
  v_pool := round(coalesce(p_receita_assinaturas, 0) * coalesce(v_pct,0) / 100.0, 2);
  if v_pool <= 0 then return jsonb_build_object('ok', true, 'pool', 0, 'pagos', 0); end if;

  -- idempotência por competência
  if exists (select 1 from public.saldo_lancamentos where origem_id like 'poolrank-'||p_competencia||'-%' limit 1) then
    return jsonb_build_object('ok', true, 'ja_distribuido', true, 'competencia', p_competencia);
  end if;

  select sum(r.pool_peso) into v_peso_total
  from public.perfis p join public.comissao_ranks r on r.rank_key = p.rank_key
  where r.pool_peso > 0 and public.eh_pagante(p.role);
  if coalesce(v_peso_total, 0) <= 0 then
    return jsonb_build_object('ok', true, 'pool', v_pool, 'pagos', 0, 'motivo', 'sem_qualificados');
  end if;

  for rr in
    select p.id, r.pool_peso, r.nome
    from public.perfis p join public.comissao_ranks r on r.rank_key = p.rank_key
    where r.pool_peso > 0 and public.eh_pagante(p.role)
  loop
    v_val := round(v_pool * rr.pool_peso / v_peso_total, 2);
    if v_val > 0 then
      v_oid := 'poolrank-'||p_competencia||'-'||rr.id;
      insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
        values (rr.id, rr.id, 'bonus_rank', 'rank', 'Bônus de reconhecimento ('||rr.nome||') — '||p_competencia,
                v_pool, rr.pool_peso, v_val, current_date, 'pendente', v_oid, 'rank');
      insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
        values (rr.id, 'bonus_rank', v_val, 'rank', v_oid, 'Bônus de reconhecimento — '||p_competencia, 'disponivel');
      v_n := v_n + 1; v_total := v_total + v_val;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'pool', v_pool, 'pagos', v_n, 'total_pago', v_total, 'competencia', p_competencia);
end;
$function$;

comment on table public.comissao_ranks is 'Plano de carreira (ranks) do Programa de Parceiros. nome=GENÉRICO ("Nível N") até o dono definir os títulos finais (linha história+liderança). Estrutura interna (RLS service-only) — não divulgar.';
comment on function public.recalcular_ranks() is 'Recalcula o rank de cada parceiro pagante (rodar mensal). Sobe na hora; só cai após meses_carencia_queda meses abaixo. Config: rank_config.';
comment on function public.distribuir_pool_rank(text, numeric) is 'Distribui o pool fechado de reconhecimento (pool_pct% da receita de assinaturas) rateado por pool_peso entre os qualificados. Bounded por definição, idempotente por competência.';
