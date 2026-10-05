-- 05/10 — acompanha 20261005_selo_doc_aceita_storage.sql: o invariante selo_documento_dessincronizado
-- replica a regra do selo (anexos_agg) e, sem isto, acusaria os ~327 lotes corrigidos como "fora de
-- sincronia". Troca só o trecho de anexos_agg, no corpo VIVO (idempotente).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if strpos(d, 'a.storage_path is not null') > 0 then return; end if; -- já aplicada
  d := replace(d,
    'and public.doc_arquivo(a.url)) as tem_edital_anexo',
    'and (public.doc_arquivo(a.url) or a.storage_path is not null)) as tem_edital_anexo');
  d := replace(d,
    'and public.doc_arquivo(a.url)) as tem_matricula_anexo',
    'and (public.doc_arquivo(a.url) or a.storage_path is not null)) as tem_matricula_anexo');
  execute d;
end $$;
