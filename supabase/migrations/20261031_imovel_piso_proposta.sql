-- 31/10 (dono: "sim, fazer tudo"): imóveis Superbid "Tomada de preço" (auction.modalityId = 5).
-- Mesmo erro dos veículos: o coletor gravava o PISO do vendedor (initialBidValue) como lance mínimo, e
-- o site mostra o preço de venda (directSaleValue). Medido na API pública em 31/10: 261 ofertas abertas,
-- 137 no acervo, 99 com preço errado e 95 com piso abaixo do preço (quase todas 10–20% abaixo).
-- Piso abaixo de 30% do preço é descartado (havia R$ 0,01 num imóvel de R$ 899 mil — lixo de cadastro).
alter table public.imoveis_leilao add column if not exists valor_piso_proposta numeric;

comment on column public.imoveis_leilao.valor_piso_proposta is
  'Superbid Tomada de preço: piso do vendedor (offerDetail.initialBidValue) quando entre 30% e 100% do preço de venda público. Não é garantia de aceite.';

-- CORREÇÃO DOS JÁ GRAVADOS (aplicada em 31/10 pela sessão; imóveis não guardam `raw`, então os valores
-- vieram da API pública lida por pg_net — `offer-query.superbid.net/offers/?filter=product.productType.
-- description:imoveis;auction.modalityId:5`, 3 páginas de 100). Para repetir: pedir as páginas com
-- public.json_pedir e trocar os ids abaixo. O desconto é recalculado aqui porque o gatilho de desconto
-- do imóvel só age quando há 2ª praça.
-- with pg as (select r.conteudo from unnest(array[<ids>]::bigint[]) id, lateral public.pagina_ler(id) r where r.status = 200),
-- o as (select jsonb_array_elements(conteudo::jsonb->'offers') of from pg),
-- p as (select 'sbid_'||(of->>'id') fid, (of->'offerDetail'->>'initialBidValue')::numeric piso,
--              (of->'offerDetail'->>'directSaleValue')::numeric venda from o
--        where of->'auction'->>'modalityId' = '5' and (of->'offerDetail'->>'directSaleValue')::numeric > 0)
-- update public.imoveis_leilao i
--    set valor_minimo = p.venda,
--        valor_piso_proposta = case when p.piso < p.venda and p.piso >= 0.3 * p.venda then p.piso end,
--        desconto_percentual = case when coalesce(i.valor_avaliacao, 0) >= p.venda and i.valor_avaliacao > 0
--                                   then round((1 - p.venda / i.valor_avaliacao) * 100)::int else 0 end
--   from p where i.fonte_id = p.fid and i.ativo;

-- VEÍCULOS: a migração 20261031_superbid_tomada_de_preco_preco_publico corrigiu o preço mas não o desconto
-- (o gatilho `trg_veiculo_desconto_preenche` só preenche quando está nulo) — o caminhão VW seguia com 38%.
update public.veiculos_leilao
   set desconto_percentual = case when coalesce(valor_avaliacao, 0) >= valor_minimo and valor_avaliacao > 0
                                  then round((1 - valor_minimo / valor_avaliacao) * 100)::int else 0 end
 where valor_piso_proposta is not null;

-- Trava de plausibilidade nos veículos também (mesma regra dos imóveis).
update public.veiculos_leilao set valor_piso_proposta = null
 where valor_piso_proposta is not null and valor_piso_proposta < 0.3 * valor_minimo;
