-- Estatísticas do acervo em UMA query, para a tela Scrapers (admin) parar de disparar ~17
-- COUNTs no cliente que estouravam sob RLS/throttle e mostravam "0% geocodificados". Só
-- contagens (sem PII). SECURITY DEFINER, só service_role (revoke de PUBLIC — o grant default
-- de EXECUTE vai p/ PUBLIC/anon). Consumida pelo /api/scraper-status (admin/analista-gated).
-- Aplicada via MCP; auditoria_seguranca 0/0.
create or replace function public.acervo_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',   (select count(*) from public.imoveis_leilao),
    'ativos',  (select count(*) from public.imoveis_leilao where ativo),
    'geocod',  (select count(*) from public.imoveis_leilao where ativo and latitude is not null and latitude <> 0),
    'sem_geo', (select count(*) from public.imoveis_leilao where ativo and (latitude is null or latitude = 0)),
    'ultima_atualizacao', (select max(atualizado_em) from public.imoveis_leilao)
  );
$$;

revoke all on function public.acervo_stats() from public;
revoke all on function public.acervo_stats() from anon, authenticated;
grant execute on function public.acervo_stats() to service_role;
