-- Cliente 360: contar o erro que o CLIENTE NÃO VIU.
--
-- POR QUE EXISTE (14/08, pedido do dono no mesmo dia em que o caso apareceu). Gerando um
-- relatório de um imóvel em Itapevi, a conexão do fetch caiu 1min43s depois do clique
-- ("Load failed"), enquanto o servidor seguia trabalhando e concluía 1min42s mais tarde. A
-- tela pintou "Falha de conexão ao gerar" e depois se consertou sozinha quando o polling
-- releu o banco. Decisão do dono: **erro que se resolve sozinho não vai para o usuário —
-- vai para o Cliente 360.**
--
-- A tela deixou de mostrar (o cliente reconcilia com o banco antes de acusar falha; ver
-- `reconciliarFalhaDeRede` em src/contexts/AnalisesContext.jsx). Some da tela E do
-- diagnóstico seria trocar um problema por outro: uma rede ruim recorrente ficaria
-- indistinguível de "nada aconteceu". Por isso o cliente passa a emitir o evento
-- `geracao_recuperada`, e é ele que este contador soma.
--
-- Âmbar, nunca vermelho: não houve prejuízo ao cliente. O que se vigia é a REPETIÇÃO —
-- o mesmo cliente ou a mesma rota aparecendo aqui várias vezes é rede/timeout a investigar.
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
    'clientes_com_erro', (select count(distinct user_id) from public.erros_cliente where resolvido = false and user_id is not null),
    'relatorios_falha_24h', (select count(*) from public.atividade_log where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '24 hours'),
    'relatorios_falha_7d',  (select count(*) from public.atividade_log where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '7 days'),
    -- ERRO INVISÍVEL AO CLIENTE: a conexão caiu, o servidor concluiu, a tela nunca acusou.
    'erros_invisiveis_24h', (select count(*) from public.eventos_atividade where tipo = 'geracao_recuperada' and criado_em > now() - interval '24 hours'),
    'erros_invisiveis_7d',  (select count(*) from public.eventos_atividade where tipo = 'geracao_recuperada' and criado_em > now() - interval '7 days'),
    'erros_invisiveis_recentes', coalesce((select jsonb_agg(x) from (
        select alvo, count(*) n, count(distinct user_id) clientes, max(criado_em) ultimo
        from public.eventos_atividade
        where tipo = 'geracao_recuperada' and criado_em > now() - interval '7 days'
        group by alvo order by count(*) desc limit 10) x), '[]'::jsonb),
    'falhas_recentes', coalesce((select jsonb_agg(x) from (
        select evento,
               coalesce(nullif(meta->>'erroApi',''), 'sem comparáveis') motivo,
               meta->>'cidade' cidade,
               count(*) n, max(criado_em) ultimo
        from public.atividade_log
        where evento ~ '_(vazio|erro|faltam_docs)$' and criado_em > now() - interval '24 hours'
        group by evento, coalesce(nullif(meta->>'erroApi',''), 'sem comparáveis'), meta->>'cidade'
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
