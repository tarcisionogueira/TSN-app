-- LOJA SUPERBID × PORTAL SUPERBID: o mesmo lote ativo duas vezes (07/11, inspeção da captação).
-- A loja (SBL_<nome>, scraper-sbidloja) não grava o que o portal (fonte SUPERBID) já traz. Mas lote que a loja gravou
-- ANTES de aparecer no portal ficava ativo nas duas fontes: com a loja enumerando 0 ("vazio"), a varredura de sumidos
-- não roda (trava de segurança) e a linha nunca saía. Em 07/11: 91 de 100 lotes SBL ativos eram duplicata do portal
-- (ECKERT 60, PRESOTTO 27, DAVISONMOREIRA, PEDROKRONBERG) — o cliente via cada imóvel duas vezes.
-- Chamada pela limpeza horária (api/desativar-encerrados-cron.js). O portal fica com o lote: é a fonte que a loja já
-- trata como dona do que ele traz.
create or replace function public.desativar_sbl_duplicados_portal()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with portal as (
    select substring(url_lote from '/oferta/(\d+)') oid from public.imoveis_leilao
     where ativo and fonte = 'SUPERBID' and url_lote ~ '/oferta/\d+'
  ), alvo as (
    select i.id from public.imoveis_leilao i
     where i.ativo and i.fonte like 'SBL\_%' and i.url_lote ~ '/oferta/\d+'
       and substring(i.url_lote from '/oferta/(\d+)') in (select oid from portal)
     limit 500
  )
  update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'duplicata_portal_superbid'
    from alvo where i.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.desativar_sbl_duplicados_portal() from public, anon, authenticated;
grant execute on function public.desativar_sbl_duplicados_portal() to service_role;
