-- 31/10 (dono: "é interessante informar"): piso do vendedor na Superbid "Tomada de preço"
-- (auction.modalityId = 5, "Mercado Balcão"). O site mostra só o preço de venda (directSaleValue);
-- o piso (initialBidValue = reservedPrice = cutValue) vem na API pública e no HTML que a página manda
-- ao navegador, mas não aparece na tela. A ficha passa a mostrá-lo como informação adicional — o
-- vendedor analisa cada proposta e decide, então NÃO é garantia de aceite (o texto da tela diz isso).
-- Só grava quando o piso é MENOR que o lance mínimo publicado; igual ou ausente = não há o que informar.
alter table public.veiculos_leilao add column if not exists valor_piso_proposta numeric;

comment on column public.veiculos_leilao.valor_piso_proposta is
  'Superbid Tomada de preço: piso do vendedor (offerDetail.initialBidValue) quando abaixo do preço de venda público. Não é garantia de aceite.';

update public.veiculos_leilao
   set valor_piso_proposta = (raw->'offerDetail'->>'initialBidValue')::numeric
 where raw->'auction'->>'modalityId' = '5'
   and (raw->'offerDetail'->>'initialBidValue')::numeric > 0
   and (raw->'offerDetail'->>'initialBidValue')::numeric < valor_minimo
   and valor_piso_proposta is distinct from (raw->'offerDetail'->>'initialBidValue')::numeric;
