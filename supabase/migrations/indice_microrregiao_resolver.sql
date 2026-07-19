-- Resolve o índice BidPro da microrregião de um imóvel (o mais específico vence:
-- bairro → grid → cidade). Usado por api/gerar-analise.js para exibir o índice BidPro
-- junto ao FipeZAP no relatório mercadológico (composição/comparação do preço de mercado).
create or replace function public.indice_microrregiao(p_imovel_id text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $fn$
  with im as (
    select cidade_norm, upper(estado) as uf,
      trim(regexp_replace(lower(translate(coalesce(bairro,''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g')) as bairro_norm,
      case when latitude is not null and latitude <> 0 and longitude is not null and longitude <> 0
           then round(latitude::numeric,2)::text || ',' || round(longitude::numeric,2)::text else null end as geo_grid
    from public.imoveis_leilao where id::text = p_imovel_id limit 1
  )
  select to_jsonb(x) from (
    select ci.venda_m2_mercado as "precoMedioM2", ci.aluguel_m2 as "aluguelM2",
           ci.nivel, ci.n_amostras, ci.fonte
    from public.cidade_indicadores ci, im
    where ci.tipo = 'residencial' and ci.cidade_norm = im.cidade_norm and ci.uf = im.uf
      and (
        (ci.nivel = 'bairro' and im.bairro_norm <> '' and ci.bairro_norm = im.bairro_norm) or
        (ci.nivel = 'grid'   and im.geo_grid is not null and ci.geo_grid = im.geo_grid) or
        (ci.nivel = 'cidade')
      )
    order by case ci.nivel when 'bairro' then 1 when 'grid' then 2 else 3 end
    limit 1
  ) x;
$fn$;
revoke execute on function public.indice_microrregiao(text) from public, anon, authenticated;
grant execute on function public.indice_microrregiao(text) to service_role;
