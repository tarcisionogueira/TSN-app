-- 31/10 (dono, print do caminhão VW 5.150 da loja SOLD: R$ 74.000 no BidPro × R$ 120.000 no site).
-- Superbid "Tomada de preço" (auction.modalityId = 5, "Mercado Balcão" no site): o preço público é
-- `offerDetail.directSaleValue`; `initialBidValue` é o piso do vendedor, que o site não mostra.
-- Os coletores gravavam o piso como lance mínimo — 14 veículos ativos com desconto falso de 12% a 68%.
-- O código passa a usar api/_superbid-preco.js; esta migração corrige o que já estava gravado.
update public.veiculos_leilao
   set valor_minimo = (raw->'offerDetail'->>'directSaleValue')::numeric
 where ativo
   and raw->'auction'->>'modalityId' = '5'
   and (raw->'offerDetail'->>'directSaleValue')::numeric > valor_minimo;
