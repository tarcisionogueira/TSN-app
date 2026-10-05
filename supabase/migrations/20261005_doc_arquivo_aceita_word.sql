-- 05/10 — Pendência 49: o selo "tem edital/matrícula" só reconhecia .pdf. O Leilão Brasil publica o
-- edital em Word em 151 de 158 lotes (.doc 119, .docx 32), que ficavam tem_edital_doc=false — sem
-- selo e, pior, o pedido ao leiloeiro pedia o edital que ele JÁ publicou. Word agora conta como
-- arquivo (os leitores do relatório passaram a abrir .doc/.docx no mesmo dia).
create or replace function public.doc_arquivo(url text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(url ~* '^https?://', false)
     and (url ~* '\.(pdf|docx?|odt|rtf)(\?|#|$)' or url ~* '/storage/v1/object/(sign|public)/');
$function$;
