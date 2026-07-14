-- Adiciona SBID9/SBID21 ao whitelist de enfileirar_docs_faltantes.
--
-- Contexto: SUPERBID e seus sub-portais SBID9/SBID21 (todos superbid.net) tinham
-- url_lote NULL porque o scraper gravava a URL do lote só em link_edital. Com o
-- scraper corrigido (scraper-puppeteer.mjs / api/scraper-leiloeiros.js) e o backfill
-- SQL (url_lote = link_edital nos ~1.5k existentes), esses imóveis passam a ter
-- url_lote http e podem ser enfileirados para captura de matrícula/edital.
-- SUPERBID já estava no whitelist; aqui incluímos SBID9/SBID21.
create or replace function public.enfileirar_docs_faltantes(p_limite integer default 3000)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with cand as (
    select il.id
    from imoveis_leilao il
    where il.ativo
      and il.fonte in ('BIASI','SOLD','ZUK','PESTANA','LEILOTECH','WEBLEILOES','VIP','VENDASGOV','SUPERBID','SBID9','SBID21','LJUD')
      and il.url_lote ~ '^https?://'
      and (il.link_matricula is null or il.link_matricula = '')
      and not exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
      and not exists (select 1 from documentos_fila f where f.imovel_id = il.id)
    limit p_limite
  ), ins as (
    insert into documentos_fila (imovel_id)
    select id from cand
    on conflict (imovel_id) do nothing
    returning imovel_id
  )
  select count(*)::int from ins;
$function$;
