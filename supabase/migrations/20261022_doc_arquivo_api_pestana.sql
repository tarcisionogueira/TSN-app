-- 22/10 — Pestana: edital e matrícula vêm com o tipo certo, mas por ENDPOINT de API sem extensão
-- (api.pestanaleiloes.com.br/sgl/v1/leiloes/6312/edital/20683019, .../lotes/441229/Matricula/20560396).
-- O selo só aceitava extensão de arquivo → 238 dos 365 lotes ativos sem selo nenhum, com o documento
-- no banco. O endpoint devolve o arquivo (o espelho baixou 344 deles; o último em 21/10). Só o padrão
-- de DOCUMENTO desse endpoint conta — página de lote/leilão continua não sendo documento.
-- Mesma régua em src/utils/documento.js (ehDocArquivo). O selo é recalculado pelo gatilho
-- zzzz_set_tem_edital_doc na próxima vez que o coletor regravar os anexos do lote.
create or replace function public.doc_arquivo(url text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(url ~* '^https?://', false)
     and (url ~* '\.(pdf|docx?|odt|rtf)(\?|#|$)' or url ~* '/storage/v1/object/(sign|public)/'
          or url ~* '^https?://api\.pestanaleiloes\.com\.br/sgl/v1/leiloes/\d+/(lotes/\d+/)?(edital|editallote|matricula|laudo|regulamento|anexos?|documentos?)/\d+/?(\?|#|$)');
$function$;
