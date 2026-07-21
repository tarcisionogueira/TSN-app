-- Métrica de cobertura por fonte: edital e matrícula passam a medir o DOCUMENTO REAL,
-- não a coluna "não nula". Antes `link_edital IS NOT NULL` dava ~100% p/ todos — mas
-- link_edital é a PÁGINA do lote por design (só LJUD/LEILOFY/PESTANA guardam PDF/endpoint
-- de edital ali). Isso deixava a cobertura de edital FALSAMENTE verde e o monitor cego.
--   • edital  = link_edital é PDF/endpoint de edital (não a página) OU anexo tipo=edital.
--   • matrícula = link_matricula é PDF (não matricula.asp) OU anexo tipo=matricula.
-- security invoker (default), search_path fixo, só service_role — não aparece no auditor.
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
      (coalesce(link_matricula,'') ~* '\.pdf' and coalesce(link_matricula,'') !~* 'matricula\.asp')
      or coalesce(jsonb_path_exists(anexos, '$[*] ? (@.tipo == "matricula")'), false)
    )/count(*))::int,
    round(100.0*count(*) filter (where
      coalesce(link_edital,'') ~* '(\.pdf|/editais/e[a-z]|/(edital|regulament))'
      or coalesce(jsonb_path_exists(anexos, '$[*] ? (@.tipo == "edital")'), false)
    )/count(*))::int,
    round(100.0*count(*) filter (where valor_avaliacao is not null and valor_avaliacao > 0 )/count(*))::int
  from imoveis_leilao
  where ativo = true
  group by fonte;
$function$;
