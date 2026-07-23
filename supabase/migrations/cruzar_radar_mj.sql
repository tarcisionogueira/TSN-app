-- Cruza o radar do MJ com o acervo: marca leiloeiro_no_acervo quando o DOMÍNIO do link já
-- aparece em imoveis_leilao.url_lote. Otimizada: dedup os domínios (dezenas) e checa cada um
-- 1x (evita o produto 322×36k que estourava o tempo). Chamada pelo scraper (service).
create or replace function public.cruzar_radar_mj()
returns integer language plpgsql security definer set search_path = 'public' as $$
begin
  with dom as (
    select distinct regexp_replace(link_leilao, '^https?://(www\.)?([^/]+).*$', '\2') as d
    from public.leiloes_mj_radar where link_leilao ~ '^https?://'
  ),
  conhecidos as (
    select d from dom
    where length(d) > 5 and exists (
      select 1 from public.imoveis_leilao i where i.url_lote ilike '%'||d||'%'
    )
  )
  update public.leiloes_mj_radar r
  set leiloeiro_no_acervo =
      (regexp_replace(r.link_leilao, '^https?://(www\.)?([^/]+).*$', '\2') in (select d from conhecidos))
  where r.link_leilao ~ '^https?://';
  return (select count(*)::int from public.leiloes_mj_radar where leiloeiro_no_acervo);
end $$;
revoke all on function public.cruzar_radar_mj() from public, anon, authenticated;
grant execute on function public.cruzar_radar_mj() to service_role;
