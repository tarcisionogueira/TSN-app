-- Resumo do desembaraço jurídico por modalidade (evolução no CNJ). Alimenta o
-- aprendizado jurídico: quantos processos daquela modalidade já encerraram
-- (baixa/arquivamento/trânsito em julgado). Preenchido pelo cnj-monitor-cron.
create or replace function public.arremate_juridico_resumo(p_modalidade text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select modalidade,
      count(*) filter (where realizado->'juridico' is not null)                      as com_processo,
      count(*) filter (where (realizado->'juridico'->>'encerrado')::boolean is true) as encerrados
    from public.arremate_aprendizado
    where realizado->'juridico' is not null
      and (p_modalidade is null or modalidade = p_modalidade)
    group by modalidade
  ) t;
$$;