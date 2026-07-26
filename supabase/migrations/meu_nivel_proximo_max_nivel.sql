-- meu_nivel(): inclui max_nivel no bloco "proximo" para a tela de indicações mostrar
-- o que o parceiro DESBLOQUEIA ao subir de nível (profundidade da rede: hoje X → Y níveis).
create or replace function public.meu_nivel()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); m record; v_rank text; v_ord int; v_prox record; v_indic numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'erro', 'sem_sessao'); end if;
  select comissao_indicacao_pct into v_indic from public.rank_config where id = 1;
  select * into m from public.rede_metricas_parceiro(v_uid);
  v_rank := public.rank_do_parceiro(v_uid);
  select ordem into v_ord from public.comissao_ranks where rank_key = v_rank;
  select * into v_prox from public.comissao_ranks where ativo and ordem > coalesce(v_ord, 0) order by ordem asc limit 1;
  return jsonb_build_object(
    'ok', true,
    'tem_rank', v_rank is not null,
    'comissao_indicacao_pct', coalesce(v_indic, 20),
    'metricas', jsonb_build_object('diretos_pagantes', coalesce(m.diretos_pagantes,0), 'rede_pagante', coalesce(m.rede_pagante,0)),
    'rank_atual', (select jsonb_build_object('nome', nome, 'ordem', ordem, 'max_nivel', max_nivel) from public.comissao_ranks where rank_key = v_rank),
    'proximo', (case when v_prox.rank_key is null then null else jsonb_build_object(
        'nome', v_prox.nome,
        'max_nivel', v_prox.max_nivel,
        'faltam_diretos', greatest(v_prox.min_diretos_pagantes - coalesce(m.diretos_pagantes,0), 0),
        'faltam_rede', greatest(v_prox.min_rede_pagante - coalesce(m.rede_pagante,0), 0)
      ) end),
    'trilha', (select jsonb_agg(jsonb_build_object('nome', nome, 'atingido', ordem <= coalesce(v_ord,0)) order by ordem) from public.comissao_ranks where ativo)
  );
end; $function$;
