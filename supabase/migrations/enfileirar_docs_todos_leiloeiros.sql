-- Enfileiramento DURÁVEL de documentos para TODOS os leiloeiros integrados.
--
-- Problema (causa-raiz da "falta de documentos em leiloeiro novo"): a versão
-- anterior de enfileirar_docs_faltantes usava um ALLOWLIST fixo de fontes
-- ('BIASI','SOLD',...,'SBID21','LJUD'). Todo leiloeiro NOVO (ex.: PECINI, LEILOFY)
-- ficava de fora até alguém lembrar de editar a lista → silenciosamente sem docs.
--
-- Correção: inverter para DENYLIST. Enfileira QUALQUER imóvel ativo com url_lote
-- http(s) e sem matrícula (link OU anexo), EXCETO as fontes que têm pipeline
-- próprio de matrícula:
--   - CEF  → captura-matricula-cef.mjs (CSV/ficha própria)
--   - SUPORTE → casos internos do admin (não é leiloeiro raspável)
-- Assim, cada leiloeiro integrado — presente e futuro — é coberto por padrão.
--
-- Melhorias adicionais:
--   * ORDER BY desconto desc → os imóveis mais atrativos (que vão para o e-mail e
--     são mais analisados) ganham documento primeiro (economia pelo resultado).
--   * Mantém a idempotência (não re-enfileira quem já está na fila).
--
-- A drenagem em cascata (fetch direto → Puppeteer → Bright Data) é feita pelo
-- job "Documentos — captura genérica" (scripts/captura-documentos.mjs), que agora
-- tem múltiplos caminhos por leiloeiro (inclusive Web Unlocker p/ sites que barram
-- o navegador, como PECINI).
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
      -- DENYLIST: cobre todo leiloeiro integrado, exceto os de pipeline próprio.
      and il.fonte not in ('CEF','SUPORTE')
      and il.url_lote ~ '^https?://'
      and (il.link_matricula is null or il.link_matricula = '')
      and not exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
      and not exists (select 1 from documentos_fila f where f.imovel_id = il.id)
    order by il.desconto_percentual desc nulls last
    limit p_limite
  ), ins as (
    insert into documentos_fila (imovel_id)
    select id from cand
    on conflict (imovel_id) do nothing
    returning imovel_id
  )
  select count(*)::int from ins;
$function$;
