-- RANKS: o nó EMPRESA (rank_config.empresa_uid) passa a ser elegível a nível, além dos
-- pagantes. Motivo (pedido do dono): TODA venda sem indicante é roteada para a empresa
-- (o dono), então o nó empresa é um participante real da rede e precisa ranquear para o
-- dono validar/acompanhar tudo pela própria conta. Aplicado em produção via MCP.
-- Efeito só de VISIBILIDADE/graduação (bônus infinito só em r6+, empresa hoje é r1=0%);
-- não altera a distribuição de comissão. auditoria_seguranca() seguiu 0/0.
-- O fechamento é MENSAL (dia 1) via cron já existente /api/ranks-recalc-cron ("0 6 1 * *").

CREATE OR REPLACE FUNCTION public.rank_do_parceiro(p_uid uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_pd int; r record; v_empresa uuid;
begin
  select empresa_uid into v_empresa from public.rank_config where id = 1;
  if not (public.eh_pagante((select role from perfis where id = p_uid)) or p_uid = v_empresa) then return null; end if;
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

CREATE OR REPLACE FUNCTION public.recalcular_ranks()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_caren int; v_n int := 0; v_changed int; r record; v_no int; v_ao int; v_empresa uuid;
begin
  select meses_carencia_queda, empresa_uid into v_caren, v_empresa from public.rank_config where id = 1;
  update public.perfis set rank_key = null, rank_meses_abaixo = 0, rank_desde = null
   where rank_key is not null and not (public.eh_pagante(role) or id = v_empresa);
  create temp table _prev on commit drop as
    select id, rank_key as prev_rank, coalesce(rank_meses_abaixo,0) as mab
    from public.perfis where (public.eh_pagante(role) or id = v_empresa);
  update public.perfis set rank_key = null where (public.eh_pagante(role) or id = v_empresa);
  for i in 1..15 loop
    with upd as (
      update public.perfis p set rank_key = public.rank_do_parceiro(p.id)
      where (public.eh_pagante(p.role) or p.id = v_empresa) and p.rank_key is distinct from public.rank_do_parceiro(p.id)
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
