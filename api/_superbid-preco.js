// PREÇO PÚBLICO DA SUPERBID NA "TOMADA DE PREÇO" (31/10, dono com print: caminhão VW 5.150 da loja
// SOLD — R$ 74.000 no BidPro, R$ 120.000 no site).
//
// Na modalidade `auction.modalityId = 5` ("Tomada de preço", que o site chama de "Mercado Balcão")
// a oferta tem DOIS valores e só um é público:
//   • `directSaleValue` (= `price`) — o "Valor de venda" que o site mostra;
//   • `initialBidValue` / `currentMinBid` / `reservedPrice` — o PISO do vendedor, que o site NÃO
//     mostra (a proposta vinculativa é avaliada contra ele).
// Os coletores pegavam `initialBidValue` como lance mínimo: publicávamos um preço que o leiloeiro
// não anuncia (e que ninguém consegue pagar pelo botão do site). Medido em 31/10: 14 de 154 veículos
// nesta modalidade com o piso abaixo do preço público; nos 4.299 de leilão comum (modalityId 1/4)
// os dois campos nunca divergem — por isso a regra vale SÓ para a modalidade 5.
//
// Devolve o preço público quando a regra se aplica, 0 caso contrário — o chamador mantém a sua
// própria cadeia de fallback: `precoVendaDiretaSuperbid(of, det) || <cadeia de sempre>`.
export const SUPERBID_MODALIDADE_TOMADA_DE_PRECO = 5;

export function precoVendaDiretaSuperbid(of, det = of?.offerDetail || {}) {
  if (Number(of?.auction?.modalityId) !== SUPERBID_MODALIDADE_TOMADA_DE_PRECO) return 0;
  const v = parseFloat(det?.directSaleValue ?? of?.directSaleValue);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
