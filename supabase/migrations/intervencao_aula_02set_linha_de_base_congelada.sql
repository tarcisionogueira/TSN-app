-- 01/09 — A LINHA DE BASE da intervenção da aula 02/09, congelada ANTES de mexer.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Gravada com a saída de `lp_aula_funil` sobre as 48h anteriores à decisão. O "depois" sai
-- da MESMA função — é essa a razão de a régua ser função e não consulta anotada.
--
-- Medido na janela (48h até 01/09 11h35 UTC):
--   431 pessoas · 606 pageviews · 7 interagiram (1,62%) · 3 clicaram no CTA (0,70%)
--   3 enviaram o formulário · 2 inscrições (0,46%)
insert into public.intervencao (chave, titulo, hipotese, mudanca, como_medir, janela_de, janela_ate, baseline, externo)
select
  'aula-02set-trafego-e-lp',
  'Aula 02/09: o conjunto LINK_CLICKS e as saidas da landing',
  'O problema nao e a pagina, e o que esta sendo comprado. A MESMA peca (REEL-2808-LIVE), na '
  'MESMA pagina, converteu 2 de 28 pessoas comprada como OUTCOME_LEADS e 0 de 54 comprada como '
  'LINK_CLICKS. Somado: 381 pessoas do conjunto LINK_CLICKS, ZERO cliques no CTA. Se a taxa '
  'fosse a mesma (7,1%), a chance de sair 0 em 381 e ~1 em 1 trilhao — entao nao e azar de '
  'amostra pequena. Em segundo plano, a LP oferece 6 saidas (Home, Calculadora, Buscar Leiloes, '
  'Planos, Entrar, logo) acima da promessa e o botao "Quero participar" cai ABAIXO da dobra nos '
  '3 tamanhos medidos.',
  'META (PENDENTE — bloqueado pelo classificador de permissoes desta sessao): pausar o conjunto '
  'BR - ABERTO - AULA 02SET (120249418573490420). CONV - AULA 02SET segue PAUSADA de proposito '
  '(ver externo.porque_nao_religar_o_conv). '
  'LP (NO AR): (1) navegacao do site suprimida em /live/:slug — eram 6 saidas acima da promessa; '
  '(2) banner de instalar o PWA suprimido na mesma rota; (3) contador do relogio compactado, que '
  'parava de caber em uma linha a 375px; (4) CTA fixo no rodape enquanto o formulario esta fora '
  'de vista, que rola ate ele e foca o primeiro campo. Medido: 1o campo do formulario saiu de '
  'y=815 para y=683 no iPhone SE (dobra em 667) e o card passou a aparecer na primeira tela; '
  'abaixo do formulario ha ~4,9 telas que antes nao tinham CTA nenhum.',
  'select * from public.lp_aula_funil(''2026-09-01T11:35:14Z''::timestamptz, now());',
  '2026-08-30T11:35:14.091787+00'::timestamptz,
  '2026-09-01T11:35:14.091787+00'::timestamptz,
  jsonb_build_object(
    'pessoas',431,'pageviews',606,'interagiram',7,'clicaram_cta',3,'clicaram_cta_fixo',0,
    'enviaram_form',3,'inscricoes',2,'pct_interagiram',1.62,'pct_clicaram_cta',0.70,'pct_inscricao',0.46),
  jsonb_build_object(
    'fonte', 'Meta Ads via conector Windsor.ai, lido em 01/09 ~11h20 UTC (01/09 e dia PARCIAL)',
    'conv_outcome_leads', jsonb_build_object(
       'campanha','CONV - AULA 02SET - INSCRICAO','campaign_id','120249379691430420',
       'adset','BR - ADV+ - AULA 02SET','adset_id','120249379704670420',
       'periodo','29-31/08','gasto_brl',109.52,'impressoes',1044,'cliques',45,'inscritos',2,
       'custo_por_inscrito_brl',54.76,
       'cpm_por_dia', jsonb_build_array(50.31,105.96,130.94),
       'ctr_por_dia', jsonb_build_array(0.0368,0.0498,0.0345)),
    'trf_link_clicks', jsonb_build_object(
       'campanha','TRF - SITE - LEILOES - AGO26','adset','BR - ABERTO - AULA 02SET',
       'adset_id','120249418573490420','periodo','31/08-01/09',
       'gasto_brl',43.76,'impressoes',6026,'cliques',545,'inscritos',0,
       'ctr_mudonome_feed_fb',0.1434,'ctr_mudonome_threads',0.3778),
    'porque_nao_religar_o_conv',
       'O CONV nao estava saudavel: CPM 50 -> 106 -> 131 em tres dias, CTR caindo 4,98% -> 3,45%, '
       'alcance despencando com gasto subindo (30/08 R$59,55 alcancou 522 pessoas; 31/08 R$41,77 '
       'alcancou 284). Ele queimou 3 listas de retargeting pequenas. Os R$54,76/inscrito sao a '
       'MEDIA; o custo MARGINAL do ultimo dia foi R$41,77 por ZERO inscrito. Religar na vespera '
       'exigiria subir verba contra publico ja esgotado — parar a perda e melhor do que iniciar '
       'gasto novo com retorno medido em queda. Reversivel: enable_campaign 120249379691430420.',
    'site_espremido',
       'O conjunto da aula comia ~2/3 do orcamento diario da campanha de trafego do site: em '
       '01/09 o conjunto BR - 25-60 - ABERTO ficou com R$2,91 contra R$21,32 da aula. Pausar '
       'devolve a verba ao trafego do site, que roda a CPC R$0,12.')
where not exists (select 1 from public.intervencao where chave = 'aula-02set-trafego-e-lp');
