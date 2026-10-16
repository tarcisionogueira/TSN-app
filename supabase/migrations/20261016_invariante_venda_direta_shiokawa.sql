-- venda_direta_com_praca acusava 2 lotes SHIOKAWA em 16/10. Não é erro de captura: a plataforma
-- (Ares, scripts/lib/ares-parse.mjs) devolve auction_type "Venda direta" COM data de encerramento —
-- venda direta com prazo para lances ("Lance Inicial"), o mesmo caso da COMPREI, que o invariante
-- já isentava. Troca pontual no corpo de qa_invariantes (a função é grande demais para recolar);
-- se o trecho não existir mais, a migração FALHA em vez de passar calada.
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.qa_invariantes'::regproc) into d;
  novo := replace(d,
    $q$and data_leilao is not null and fonte <> 'COMPREI'), 0)$q$,
    $q$and data_leilao is not null and fonte not in ('COMPREI', 'SHIOKAWA')), 0)$q$);
  if novo = d then raise exception 'trecho de venda_direta_com_praca não encontrado em qa_invariantes'; end if;
  execute novo;
end $$;
