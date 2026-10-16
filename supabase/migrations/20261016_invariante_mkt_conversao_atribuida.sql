-- mkt_conversoes_maior_que_cliques acusou Meta Ads 16/10: gasto 0, cliques 0, conversões 1. Não é
-- coluna trocada: o Meta credita a conversão no dia em que ela acontece, mesmo com o clique dias
-- antes (campanha pausada inclusive). O sinal de coluna trocada só existe em dia com clique ou gasto.
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.qa_invariantes'::regproc) into d;
  novo := replace(d,
    $q$(select count(*) from marketing_metricas_dia where conversoes > cliques), 0)$q$,
    $q$(select count(*) from marketing_metricas_dia where conversoes > cliques and (cliques > 0 or gasto > 0)), 0)$q$);
  if novo = d then raise exception 'trecho de mkt_conversoes_maior_que_cliques não encontrado em qa_invariantes'; end if;
  execute novo;
end $$;
