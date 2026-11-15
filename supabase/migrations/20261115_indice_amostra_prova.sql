-- 15/11 — ESTADO DE PROVA DE CADA AMOSTRA, calculado na leitura (arena 15/11, P1; #484). Sem rede, sem UPDATE no acervo:
--   sem_link     — a pesquisa não trouxe link (o número é só o que a IA declarou);
--   listagem     — página de busca/listagem do portal (URL que serve a várias amostras, ou sem identificador de anúncio);
--   link_proprio — link de um anúncio individual (identificador ou caminho de anúncio na URL) (ainda NÃO conferido: conferência ao vivo é o passo seguinte).
-- Vai para o selo do cliente: "n unidades · x com link próprio · y de página de busca · z sem link".
create or replace view public.indice_amostra_indep with (security_invoker = true) as
select distinct on (k.grupo) k.id, k.cidade_norm, k.uf, k.bairro_norm, k.geo_grid, k.tipo, k.especie, k.valor_m2, k.valor_total,
  k.area_m2, k.data_ref, k.fonte, k.origem, k.imovel_id, k.analise_id, k.criado_em, k.lat, k.lng, k.url, k.endereco, k.condominio,
  k.cep, k.geocod_em, k.geo_nivel, k.coord_origem, k.grupo,
  count(*) over (partition by k.grupo) as n_copias,
  case when k.url is null then 'sem_link'
       when k.n_url > 1 then 'listagem'
       -- anúncio individual: identificador no caminho, ou o caminho típico de anúncio dos portais (conferido em 15/11
       -- contra URLs reais: imovelweb …-3211516710.html, quintoandar /imovel/891638361, casamineira /imovel/…-cod-0029,
       -- rentola /listings/…; e busca: lopes /busca/…, vivareal /imoveis/apartamento/venda/…, zap /aluguel/imoveis/…).
       when substring(k.url from '^https?://[^/]+(/[^?#]*)') ~* '\d{5,}|[-_/]id[-_]?\d+|ID_?\d{4,}|MV-\d{4}|/(imovel|listings|anuncio|propriedades)/|-cod-'
         then 'link_proprio'
       else 'listagem' end as prova
from (
  select a.*,
    count(*) over (partition by a.url) as n_url,
    coalesce(
      case when a.valor_total > 0 and a.area_m2 > 0 then
        a.cidade_norm||'|'||a.uf||'|'||coalesce(a.tipo,'')||'|'||a.especie||'|'||coalesce(a.bairro_norm,'')||'|'||round(a.valor_total)::text||'|'||round(a.area_m2)::text
      end, 'id:'||a.id::text) as grupo
  from public.indice_amostra a
) k
order by k.grupo, (k.url is not null) desc, (k.coord_origem = 'geocodificada') desc nulls last, k.data_ref desc nulls last, k.criado_em desc;
revoke all on public.indice_amostra_indep from public, anon, authenticated;
grant select on public.indice_amostra_indep to service_role;
