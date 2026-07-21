-- Frentes B+C da revisão do admin: AGREGA no SERVIDOR as contagens do Dashboard (por role/plano,
-- total, inadimplentes, novos no período, reembolsos, tamanho do banco) + os números do ACERVO
-- (imóveis ativos e fotos no Storage) numa RPC só. Antes a tela puxava a tabela `perfis` INTEIRA
-- pro navegador e somava no cliente (não escala p/ 10k+), e contava "imóveis ativos" por um count
-- client-side que PODIA DIVERGIR do /api/scraper-status (acervo_stats). Agora:
--   • perf: 1 chamada agregada, nada de full-table no cliente (rumo a 10k usuários);
--   • dedup do KPI: `imoveis_ativos` sai do MESMO count de acervo_stats (= Operação de Coleta).
-- O MRR continua no cliente (usa os preços do planos_config via usePlanos), só que agora sobre as
-- CONTAGENS agregadas aqui — a régua de preço/anual (mrrMensalPlano) fica numa fonte só.
-- Admin-gated (raise se não for admin), SECURITY DEFINER, search_path '' — padrão dos demais admin_*.
create or replace function public.admin_dashboard_contadores(p_inicio timestamptz, p_fim timestamptz)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    -- Contagem por role NORMALIZADO (tira o sufixo _anual → soma ao plano-base; role fora do
    -- conjunto conhecido cai em "outros"). Espelha a normalização que a tela fazia no cliente.
    'contagem', (
      select jsonb_build_object(
        'admin',       count(*) filter (where r = 'admin'),
        'explorador',  count(*) filter (where r = 'explorador'),
        'top2',        count(*) filter (where r = 'top2'),
        'assessorado', count(*) filter (where r = 'assessorado'),
        'clube',       count(*) filter (where r = 'clube'),
        'consultor',   count(*) filter (where r = 'consultor'),
        'analista',    count(*) filter (where r = 'analista'),
        'advogado',    count(*) filter (where r = 'advogado'),
        'outros',      count(*) filter (where r not in
          ('admin','explorador','top2','assessorado','clube','consultor','analista','advogado')))
      from (select regexp_replace(coalesce(role,''), '_anual$', '') as r from public.perfis) s),
    'total',                (select count(*) from public.perfis),
    'inadimplentes',        (select count(*) from public.perfis where inadimplente_desde is not null),
    'novos',                (select count(*) from public.perfis where created_at >= p_inicio and created_at <= p_fim),
    'reembolsos_pendentes', (select count(*) from public.reembolsos_garantia where status = 'solicitado'),
    'db_size_mb',           round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2),
    -- Acervo: MESMA semântica de acervo_stats (fonte única do "imóveis ativos") + fotos no Storage.
    'imoveis_ativos',       (select count(*) from public.imoveis_leilao where ativo),
    'fotos_storage',        (select count(*) from public.imoveis_leilao where ativo and link_foto like '%supabase%'),
    'gerado_em', now());
end;
$fn$;
revoke execute on function public.admin_dashboard_contadores(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard_contadores(timestamptz, timestamptz) to authenticated, service_role;
