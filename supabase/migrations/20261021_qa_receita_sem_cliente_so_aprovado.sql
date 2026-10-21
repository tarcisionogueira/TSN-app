-- 21/10 (bug bounty): o invariante `receita_sem_cliente` acusava 1 caso que era um cartão RECUSADO
-- (cc_rejected_high_risk) de uma conta já excluída — FK com on delete set null deixa user_id nulo.
-- Recusa não é venda: o invariante passa a olhar só pagamento aprovado. Aplicado por substituição
-- no corpo vivo de qa_invariantes() (a função é grande e outras partes mudam fora deste arquivo).
do $$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc); n text;
begin
  n := replace(d, $x$where origem in ('avulso','recorrente') and user_id is null), 0)$x$,
                  $x$where origem in ('avulso','recorrente') and user_id is null and status = 'approved'), 0)$x$);
  if n = d then raise notice 'receita_sem_cliente já corrigido'; return; end if;
  execute n;
end $$;
