-- anexo_email_nao_arquivado: anexo marcado `enviado:false` (não foi no e-mail — ver
-- 20261016_email_anexos_nao_entregues.sql) não tem o que arquivar. Contá-lo seria medir
-- "linha sem arquivo" com o nome de "anexo que vamos perder" (forma nº 10).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.qa_invariantes'::regproc) into d;
  novo := replace(d,
    $q$where c.resend_email_id is not null and a->>'arquivo' is null and c.criado_em < now() - interval '3 days'$q$,
    $q$where c.resend_email_id is not null and a->>'arquivo' is null and coalesce(a->>'enviado', 'true') <> 'false' and c.criado_em < now() - interval '3 days'$q$);
  if novo = d then raise exception 'trecho de anexo_email_nao_arquivado não encontrado em qa_invariantes'; end if;
  execute novo;
end $$;
