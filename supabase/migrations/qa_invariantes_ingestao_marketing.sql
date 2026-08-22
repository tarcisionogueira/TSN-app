-- =====================================================================================
-- ITEM 5 (lista de 21/08) — VALIDAÇÃO DE INGESTÃO DE MARKETING (classe 10 / forma #8)
--
-- O gap #5 cobriu o Censo e deixou anotado: "não cobre marketing_metricas_dia". Esta é a
-- extensão. A ingestão do Google Ads (ads-metrics-ingest, ~10h50 UTC, traz o dia ANTERIOR)
-- tem as mesmas formas de falha silenciosa: parar sem gritar (a tabela simplesmente para de
-- crescer), número plausível-e-errado (separador decimal no gasto: R$ 23,33 → 2.333),
-- coluna trocada (conversões no lugar de cliques) e o rastreador perdendo o gclid
-- (o caso 19/214 de 14/08 — cliques pagos sem visita correspondente).
--
-- Cinco invariantes, todos LIMITE 0 e VERDES na calibração de 21/08 contra o dado real
-- (última data = D-1 · 0 conversões>cliques · 0 negativos · mediana de gasto 28d = R$ 23,33,
-- máximo R$ 37,90 · 7d: 194 cliques × 256 visitas com gclid):
--   · mkt_ingestao_atrasada — último dia < D-2. A ingestão traz D-1 às ~10h50 UTC; antes
--       disso "último = anteontem" é NORMAL (D-2 ainda é verde) — só D-3+ alerta.
--   · mkt_gasto_implausivel — dia com gasto > 20× a mediana 28d (piso 1). Mediana real
--       R$ 23 → alerta acima de ~R$ 466: pega escala/separador (1.000×), não pico legítimo.
--   · mkt_conversoes_maior_que_cliques — impossível na atribuição por clique; coluna trocada.
--   · mkt_valor_negativo — parse quebrado.
--   · mkt_clique_pago_sem_rastreio — 7d com 50+ cliques pagos e visitas com gclid < 20%
--       deles: o dinheiro está indo, o rastreador não está vendo (razão real hoje: 132%).
--
-- Idempotente, cirurgia de string sobre o prosrc VIVO (mesmo idioma de
-- qa_invariantes_ingestao_externa.sql). APLICADA em produção em 21/08 (5 chaves mkt_* ok).
-- ⚠️ 22/08: a cirurgia de string recria qa_invariantes SEM reemitir `set search_path` — ver
-- qa_invariantes_restaura_search_path.sql. Toda futura recriação por prosrc DEVE reincluí-lo.
-- =====================================================================================
do $outer$
declare corpo text; novo text; bloco text;
begin
  select prosrc into corpo from pg_proc where proname = 'qa_invariantes';
  if corpo is null then raise exception 'qa_invariantes nao existe'; end if;

  -- Já aplicado? (idempotência)
  if position('mkt_gasto_implausivel' in corpo) > 0 then return; end if;

  -- Âncora de inserção: o mesmo último invariante usado pelo gap #5.
  if position('(''lote_sem_area_nem_matricula''' in corpo) = 0 then
    raise exception 'ancora (lote_sem_area_nem_matricula) nao encontrada em qa_invariantes';
  end if;

  bloco := $blk$     ('mkt_ingestao_atrasada','Marketing: ingestao do Google Ads parada (ultimo dia < D-2; D-1 chega ~10h50 UTC)','Ingestao','bug',
       (select (case when coalesce(max(data), date '1970-01-01') < current_date - 2 then 1 else 0 end)::bigint
          from marketing_metricas_dia), 0),
     ('mkt_gasto_implausivel','Marketing: dia com gasto >20x a mediana 28d — separador decimal/escala','Ingestao','bug',
       (select count(*) from marketing_metricas_dia m
         where m.data > current_date - 28
           and m.gasto > 20 * greatest((select percentile_cont(0.5) within group (order by gasto)
                                          from marketing_metricas_dia where data > current_date - 28 and gasto > 0), 1)), 0),
     ('mkt_conversoes_maior_que_cliques','Marketing: conversoes > cliques no mesmo dia/canal — coluna trocada','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where conversoes > cliques), 0),
     ('mkt_valor_negativo','Marketing: gasto/cliques/conversoes negativo — parse quebrado','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where gasto < 0 or cliques < 0 or conversoes < 0), 0),
     ('mkt_clique_pago_sem_rastreio','Marketing: 7d com 50+ cliques pagos e <20% de visitas com gclid — rastreador perdendo','Ingestao','bug',
       (select (case when coalesce((select sum(cliques) from marketing_metricas_dia where data > current_date - 8), 0) >= 50
           and (select count(*) from visita_origem
                  where primeira_em > now() - interval '8 days'
                    and (gclid is not null or gbraid is not null or wbraid is not null))
               < 0.2 * (select sum(cliques) from marketing_metricas_dia where data > current_date - 8)
         then 1 else 0 end)::bigint), 0),
$blk$;

  novo := replace(corpo, '(''lote_sem_area_nem_matricula''', bloco || '     (''lote_sem_area_nem_matricula''');
  if novo = corpo then raise exception 'NAO SUBSTITUIU — replace nao alterou o corpo'; end if;
  if position('mkt_gasto_implausivel' in novo) = 0 then raise exception 'invariantes novos nao entraram'; end if;
  if position('(''lote_sem_area_nem_matricula''' in novo) = 0 then raise exception 'comeu o invariante seguinte'; end if;

  execute 'create or replace function public.qa_invariantes() returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) language sql stable as $corpo$' || novo || '$corpo$';
end $outer$;
