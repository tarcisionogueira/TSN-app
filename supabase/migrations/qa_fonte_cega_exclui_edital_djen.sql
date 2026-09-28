-- fonte_cega_no_monitor acusava EDITAL_DJEN todo dia desde 10/09: o Radar de Editais não grava
-- fonte_saude por desenho, e o monitor já o vigia pelo FRESCOR do acervo (FONTES_SEM_SAUDE em
-- api/monitor-fontes-cron.js) + o invariante radar_editais_sem_pull. Alarme permanente ensina a
-- ignorar o painel — a fonte sai da conta; qualquer outra fonte nova sem saúde continua acusando.
do $$
declare d text; antes text := 'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'qa_invariantes' and p.pronargs = 0 and p.pronamespace = 'public'::regnamespace;
  if position('i.fonte <> ''EDITAL_DJEN'' and not exists (select 1 from fonte_saude' in d) > 0 then return; end if;
  if position(antes in d) = 0 then raise exception 'qa_invariantes: âncora de fonte_cega_no_monitor não encontrada'; end if;
  d := replace(d, antes, 'where i.ativo and i.fonte <> ''EDITAL_DJEN'' and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)');
  execute d;
end $$;
