-- Cruza o radar do MJ com o acervo: marca leiloeiro_no_acervo quando o DOMÍNIO do link do
-- leilão já aparece em imoveis_leilao (url_lote/link_edital). Chamada pelo scraper (service).
create or replace function public.cruzar_radar_mj()
returns integer language plpgsql security definer set search_path = 'public' as $$
begin
  update public.leiloes_mj_radar r
  set leiloeiro_no_acervo = exists (
    select 1 from public.imoveis_leilao i
    where i.url_lote   ilike '%' || regexp_replace(r.link_leilao, '^https?://(www\.)?([^/]+).*$', '\2') || '%'
       or i.link_edital ilike '%' || regexp_replace(r.link_leilao, '^https?://(www\.)?([^/]+).*$', '\2') || '%'
  )
  where r.link_leilao ~ '^https?://';
  return (select count(*)::int from public.leiloes_mj_radar where leiloeiro_no_acervo);
end $$;
revoke all on function public.cruzar_radar_mj() from public;
revoke all on function public.cruzar_radar_mj() from anon, authenticated;
grant execute on function public.cruzar_radar_mj() to service_role;
