-- 22/10 (#284) — LEJE: documento do lote por `leje.com.br/docs.php?doc=<n>` (sem extensão no endereço;
-- o ".pdf" fica só no nome). O coletor passou a lê-los (lib/leje-parse.mjs documentosLeje) e o runner
-- residencial copia o arquivo para o nosso bucket (o site bloqueia datacenter). Mesma régua no front.
create or replace function public.doc_arquivo(url text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(url ~* '^https?://', false)
     and (url ~* '\.(pdf|docx?|odt|rtf)(\?|#|$)' or url ~* '/storage/v1/object/(sign|public)/'
          or url ~* '^https?://api\.pestanaleiloes\.com\.br/sgl/v1/leiloes/\d+/(lotes/\d+/)?(edital|editallote|matricula|laudo|regulamento|anexos?|documentos?)/\d+/?(\?|#|$)'
          or url ~* '^https?://(www\.)?leje\.com\.br/docs\.php\?doc=\d+$');
$function$;
