-- Aprendizado da IA de indicadores: demanda AGREGADA (anônima) das buscas e
-- visualizações dos últimos 30 dias, para o diagnóstico dar DIRECIONAMENTOS
-- (onde há procura sem oferta → captar leiloeiro/rodar campanha). Sem PII —
-- só contagens por cidade/tipo/forma. SECURITY DEFINER, execute só service_role.
create or replace function public.demanda_busca_agregada()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'periodo_dias', 30,
    'total_buscas', (select count(*) from public.busca_historico where criado_em > now() - interval '30 days'),
    -- Cidades mais buscadas (+ média de resultados: baixa = pouca oferta).
    'top_cidades', coalesce((select jsonb_agg(x) from (
      select cidade, estado, count(*) as buscas, round(avg(resultados_count)) as media_resultados
      from public.busca_historico
      where criado_em > now() - interval '30 days' and cidade is not null
      group by cidade, estado order by count(*) desc limit 15) x), '[]'::jsonb),
    -- DEMANDA SEM OFERTA: buscas que voltaram 0 resultados = procura não atendida.
    'demanda_sem_oferta', coalesce((select jsonb_agg(x) from (
      select cidade, estado, count(*) as buscas_sem_resultado
      from public.busca_historico
      where criado_em > now() - interval '30 days' and cidade is not null and coalesce(resultados_count, 0) = 0
      group by cidade, estado order by count(*) desc limit 15) x), '[]'::jsonb),
    'top_tipos', coalesce((select jsonb_agg(x) from (
      select tipo_imovel, count(*) as buscas from public.busca_historico
      where criado_em > now() - interval '30 days' and tipo_imovel is not null
      group by tipo_imovel order by count(*) desc limit 10) x), '[]'::jsonb),
    'top_pagamento', coalesce((select jsonb_agg(x) from (
      select forma, count(*) as buscas from (
        select unnest(pagamento_tipos) as forma from public.busca_historico
        where criado_em > now() - interval '30 days' and pagamento_tipos is not null
      ) t group by forma order by count(*) desc limit 6) x), '[]'::jsonb),
    -- Imóveis mais VISUALIZADOS (interesse concreto por região/tipo).
    'imoveis_mais_vistos', coalesce((select jsonb_agg(x) from (
      select cidade, estado, tipo, count(distinct user_id) as pessoas, sum(vezes) as visitas
      from public.imovel_visto
      where visto_em > now() - interval '30 days' and cidade is not null
      group by cidade, estado, tipo order by sum(vezes) desc limit 12) x), '[]'::jsonb)
  );
$$;

revoke execute on function public.demanda_busca_agregada() from anon, authenticated;
grant execute on function public.demanda_busca_agregada() to service_role;
