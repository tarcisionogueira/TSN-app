-- 20/09 (pedido do dono: "os documentos que precisamos, independente do formato"). A régua de
-- edital/matrícula de fonte_cobertura() (fonte_cobertura_edital_real.sql, 12/09) só reconhecia
-- `.pdf` — LEILAOBRASIL/LUTHERO (infra Suporte Leilões, integrados em 19/09) publicam edital em
-- `.doc`/`.docx`, e apareciam como 3% de edital no monitor quando o real era ~100%: o instrumento
-- media "é PDF?" e reportava com o nome de "tem o documento?" (forma nº 10 do CLAUDE.md). Mesmo
-- conjunto de extensões de RE_DOC_EXT (api/_doc-scan.js), o extrator genérico que já reconhece
-- qualquer formato de documento real.
create or replace function public.fonte_cobertura()
returns table(fonte text, ativos bigint, foto integer, valor integer, area integer, data integer, matricula integer, edital integer, avaliacao integer)
language sql
set search_path to 'public'
as $function$
  select
    fonte,
    count(*) as ativos,
    round(100.0*count(*) filter (where link_foto      is not null and link_foto      <> '')/count(*))::int,
    round(100.0*count(*) filter (where valor_minimo   is not null and valor_minimo   >  0 )/count(*))::int,
    round(100.0*count(*) filter (where area_m2        is not null and area_m2        >  0 )/count(*))::int,
    round(100.0*count(*) filter (where data_leilao    is not null and data_leilao    <> '')/count(*))::int,
    round(100.0*count(*) filter (where
      (coalesce(link_matricula,'') ~* '\.(pdf|docx?|xlsx?|odt|rtf)' and coalesce(link_matricula,'') !~* 'matricula\.asp')
      or coalesce(jsonb_path_exists(anexos, '$[*] ? (@.tipo == "matricula")'), false)
    )/count(*))::int,
    round(100.0*count(*) filter (where
      coalesce(link_edital,'') ~* '(\.(pdf|docx?|xlsx?|odt|rtf)|/editais/e[a-z]|/(edital|regulament))'
      or coalesce(jsonb_path_exists(anexos, '$[*] ? (@.tipo == "edital")'), false)
    )/count(*))::int,
    round(100.0*count(*) filter (where valor_avaliacao is not null and valor_avaliacao > 0 )/count(*))::int
  from imoveis_leilao
  where ativo = true
  group by fonte;
$function$;
