-- 18/09, achado inspecionando Cliente 360: `falhas_recentes` rotulava TODO
-- `relatorio_mercado_vazio` como "sem comparáveis" quando `meta.erroApi` estava vazio — mas
-- o motivo real vinha só em `meta.geminiErro` (ex.: "HTTP 429: Your prepayment credits are
-- depleted"), nunca checado. Achado ao vivo: 6 tentativas seguidas no mesmo imóvel (Guaçuí,
-- 16-17/09) todas com créditos do Gemini esgotados, todas exibidas como "sem comparáveis" —
-- a forma nº 5 do próprio CLAUDE.md ("o freio de custo entregue como conteúdo"), agora
-- também no PAINEL DE DIAGNÓSTICO que existe justamente para pegar isso.
create or replace function public.admin_360_estatisticas()
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  with cli as (select * from public.perfis where role not in ('admin','analista','advogado','consultor'))
  select jsonb_build_object(
    'total_clientes', (select count(*) from cli),
    'sem_perfil', (select count(*) from cli where perfil_investidor is null),
    'por_plano', coalesce((select jsonb_object_agg(role, n) from (select role, count(*) n from cli group by role) t), '{}'::jsonb),
    'por_perfil', coalesce((select jsonb_object_agg(coalesce(perfil_investidor, '(sem perfil)'), n) from (select perfil_investidor, count(*) n from cli group by perfil_investidor) t), '{}'::jsonb),
    'buscas_total', (select count(*) from public.busca_historico),
    'vistos_total', (select count(*) from public.imovel_visto),
    'relatorios', jsonb_build_object(
      'mercado', (select count(*) from public.analises_mercado),
      'documental', (select count(*) from public.analises_documental),
      'laudo', (select count(*) from public.analises_laudo)),
    'top_cidades', coalesce((select jsonb_agg(x) from (select cidade, count(*) n from public.busca_historico where cidade is not null and cidade <> '' group by cidade order by n desc limit 8) x), '[]'::jsonb),
    'top_tipos', coalesce((select jsonb_agg(x) from (select tipo_imovel, count(*) n from public.busca_historico where tipo_imovel is not null and tipo_imovel <> '' group by tipo_imovel order by n desc limit 8) x), '[]'::jsonb),
    'erros_abertos_total', (select count(*) from public.erros_cliente where resolvido = false),
    'alerta_incompleto_7d', (select count(*) from public.alerta_cobertura where executado_em > now() - interval '7 days'),
    'alerta_incompleto_clientes', (select count(distinct user_id) from public.alerta_cobertura where executado_em > now() - interval '7 days'),
    'alerta_incompleto_recentes', coalesce((select jsonb_agg(x) from (
        select c.executado_em, c.encontrados, c.vagas, c.contrato, c.regiao, c.raio_max_m,
               c.cidade_ref, c.uf_ref, p.nome, p.role
          from public.alerta_cobertura c left join public.perfis p on p.id = c.user_id
         where c.executado_em > now() - interval '30 days'
         order by c.executado_em desc limit 10) x), '[]'::jsonb),
    'clientes_com_erro', (select count(distinct user_id) from public.erros_cliente where resolvido = false and user_id is not null),
    'erros_abertos_lista', coalesce((select jsonb_agg(x) from (
        select e.user_id, p.nome, p.role, e.rota, left(e.msg,220) as msg, e.ocorrencias,
               e.primeira_em, e.ultima_em
          from public.erros_cliente e left join public.perfis p on p.id = e.user_id
         where e.resolvido = false
         order by e.ultima_em desc limit 20) x), '[]'::jsonb),
    'relatorios_falha_24h', (select count(*) from public.atividade_log where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '24 hours'),
    'relatorios_falha_7d',  (select count(*) from public.atividade_log where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '7 days'),
    'erros_invisiveis_24h', (select count(*) from public.eventos_atividade where tipo = 'geracao_recuperada' and criado_em > now() - interval '24 hours'),
    'erros_invisiveis_7d',  (select count(*) from public.eventos_atividade where tipo = 'geracao_recuperada' and criado_em > now() - interval '7 days'),
    'erros_invisiveis_recentes', coalesce((select jsonb_agg(x) from (
        select alvo, count(*) n, count(distinct user_id) clientes, max(criado_em) ultimo
        from public.eventos_atividade
        where tipo = 'geracao_recuperada' and criado_em > now() - interval '7 days'
        group by alvo order by count(*) desc limit 10) x), '[]'::jsonb),
    'falhas_recentes', coalesce((select jsonb_agg(x) from (
        select evento,
               case
                 when nullif(meta->>'erroApi','') is not null then meta->>'erroApi'
                 -- NOVO (18/09): geminiErro é onde a busca "mercado ao vivo" grava o motivo
                 -- real quando o Gemini recusa (429 orçamento/créditos, 403 projeto negado,
                 -- etc.) — erroApi fica null nesses casos, e sem este branch a UI mostrava
                 -- "sem comparáveis" por cima de um freio de custo, escondendo do dono
                 -- justamente o que ele precisa ver primeiro.
                 when nullif(meta->>'geminiErro','') is not null then meta->>'geminiErro'
                 when evento = 'relatorio_documental_faltam_docs' and jsonb_typeof(meta->'faltando') = 'array'
                   then 'faltam: ' || (select string_agg(f, ', ') from jsonb_array_elements_text(meta->'faltando') f)
                 when evento = 'relatorio_mercado_vazio' then 'sem comparáveis'
                 else 'motivo não registrado'
               end motivo,
               meta->>'cidade' cidade,
               count(*) n, max(criado_em) ultimo
        from public.atividade_log
        where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '24 hours'
        group by evento, motivo, meta->>'cidade'
        order by count(*) desc limit 10) x), '[]'::jsonb),
    'funil_publico', jsonb_build_object(
      'visitantes_7d', (select count(distinct anon_id) from public.eventos_atividade where user_id is null and criado_em > now() - interval '7 days'),
      'pageviews_7d', (select count(*) from public.eventos_atividade where user_id is null and tipo = 'pageview' and criado_em > now() - interval '7 days'),
      'erros_7d', (select count(*) from public.eventos_atividade where user_id is null and tipo in ('api_erro','api_falha_rede') and criado_em > now() - interval '7 days'),
      'por_rota', coalesce((select jsonb_agg(x) from (
          select rota, count(*) n, count(distinct anon_id) visitantes
          from public.eventos_atividade
          where user_id is null and tipo = 'pageview' and criado_em > now() - interval '7 days'
          group by rota order by n desc limit 8) x), '[]'::jsonb),
      'ultimos', coalesce((select jsonb_agg(x) from (
          select tipo, rota, alvo, detalhe, criado_em
          from public.eventos_atividade
          where user_id is null and criado_em > now() - interval '7 days'
          order by criado_em desc limit 20) x), '[]'::jsonb)
    )
  );
$function$;
