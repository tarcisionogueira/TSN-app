-- Painel "Seu nível" enxuto (pedido do dono): mostrar só o nível atual + o PRÓXIMO (não a
-- trilha inteira), com quanto ganho na VENDA (nível 1 = 25%) e quanto ganho da EQUIPE
-- (níveis 2..profundidade do rank) hoje e ao subir de nível.
create or replace function public.meu_nivel()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_rank text; v_ord int; v_indic numeric;
        v_prox record; v_pd int; v_tem int; v_sub_nome text;
        v_maxn int; v_prox_maxn int; v_venda numeric; v_eq numeric; v_eq_prox numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'erro', 'sem_sessao'); end if;
  select role, rank_key into v_role, v_rank from perfis where id = v_uid;
  select comissao_indicacao_pct into v_indic from rank_config where id = 1;
  select ordem into v_ord from comissao_ranks where rank_key = v_rank;
  v_ord := coalesce(v_ord, 0);
  select count(*) into v_pd from perfis c where c.indicado_por = v_uid and eh_pagante(c.role);
  select * into v_prox from comissao_ranks where ativo and ordem > v_ord order by ordem asc limit 1;

  select coalesce(pct,25) into v_venda from comissao_regras where tipo='assinatura' and nivel=1 and ativo;
  select coalesce(max_nivel,0) into v_maxn from comissao_ranks where rank_key = v_rank;
  v_maxn := coalesce(v_maxn, 0);
  select coalesce(sum(pct),0) into v_eq from comissao_regras where tipo='assinatura' and ativo and nivel between 2 and v_maxn;

  if v_prox.rank_key is not null then
    if v_prox.ordem = 1 then
      v_tem := v_pd; v_sub_nome := 'indicado pagante ativo';
    else
      select count(*) into v_tem from perfis c join comissao_ranks cr on cr.rank_key = c.rank_key
        where c.indicado_por = v_uid and cr.ordem >= v_prox.req_sub_ordem;
      select nome into v_sub_nome from comissao_ranks where ordem = v_prox.req_sub_ordem;
    end if;
    v_prox_maxn := coalesce(v_prox.max_nivel,0);
    select coalesce(sum(pct),0) into v_eq_prox from comissao_regras where tipo='assinatura' and ativo and nivel between 2 and v_prox_maxn;
  end if;

  return jsonb_build_object(
    'ok', true, 'tem_rank', v_rank is not null, 'comissao_indicacao_pct', coalesce(v_indic, 25),
    'diretos_pagantes', coalesce(v_pd,0), 'venda_pct', coalesce(v_venda,25),
    'equipe', jsonb_build_object('niveis', greatest(v_maxn-1,0), 'pct_total', coalesce(v_eq,0)),
    'rank_atual', (select jsonb_build_object('nome',nome,'ordem',ordem,'max_nivel',max_nivel,'bonus_infinito_pct',coalesce(bonus_infinito_pct,0)) from comissao_ranks where rank_key = v_rank),
    'proximo', (case when v_prox.rank_key is null then null else jsonb_build_object(
        'nome', v_prox.nome, 'req_pernas', v_prox.req_pernas, 'sub_nome', v_sub_nome,
        'tem', coalesce(v_tem,0), 'faltam', greatest(v_prox.req_pernas - coalesce(v_tem,0), 0),
        'bonus_infinito_pct', coalesce(v_prox.bonus_infinito_pct,0),
        'equipe_niveis', greatest(coalesce(v_prox_maxn,0)-1,0), 'equipe_pct_total', coalesce(v_eq_prox,0),
        'equipe_delta_pct', greatest(coalesce(v_eq_prox,0) - coalesce(v_eq,0), 0)) end)
  );
end; $function$;
