// Fixture REAL (offer-query, 23/09/2026, IP residencial) — campos mínimos das 5 ofertas.
import assert from 'node:assert/strict';
import { classificarOferta } from '../lib/superbid-resultado.mjs';

const st = (o = {}) => ({ sold: false, closed: false, removed: false, closedToBids: false, statusCode: 6, ...o });
const casos = [
  ['5008418 retirada (banco dizia vendido)', { totalBids: 0, winnerBid: {}, endDateTime: 1789730568000, offerDetail: { currentMaxBid: 1721807.43, reservedPrice: 1721807.43 }, offerStatus: st({ removed: true }), quantitySold: 0, hasReceivedBidsOrProposals: false }, 'retirado'],
  ['4970636 sem lance (banco dizia vendido)', { totalBids: 0, winnerBid: {}, endDateTime: 1789736400000, offerDetail: { currentMaxBid: 98300, reservedPrice: 98300 }, offerStatus: st(), quantitySold: 0, hasReceivedBidsOrProposals: false }, 'sem_lance'],
  ['5010073 sem lance (banco dizia vendido)', { totalBids: 0, winnerBid: {}, endDateTime: 1790082900000, offerDetail: { currentMaxBid: 1900000, reservedPrice: 1900000 }, offerStatus: st(), quantitySold: 0, hasReceivedBidsOrProposals: false }, 'sem_lance'],
  ['4977027 lance abaixo da reserva', { totalBids: 1, winnerBid: { currentWinner: 1699610 }, endDateTime: 1790131560000, offerDetail: { currentMaxBid: 1473, reservedPrice: 1820.63 }, offerStatus: st({ closedToBids: true, statusCode: 1 }), quantitySold: 0, hasReceivedBidsOrProposals: true }, 'condicional'],
  ['4977041 sem lance', { totalBids: 0, winnerBid: {}, endDateTime: 1790129760000, offerDetail: { currentMaxBid: 984, reservedPrice: 1291.2 }, offerStatus: st({ closedToBids: true, statusCode: 1 }), quantitySold: 0, hasReceivedBidsOrProposals: false }, 'sem_lance'],
  // sintéticos: vencedor acima da reserva; campo de lances ausente; ainda aberto
  ['vendido acima da reserva', { totalBids: 3, winnerBid: { currentWinner: 1 }, endDateTime: 1790129760000, offerDetail: { currentMaxBid: 1500, reservedPrice: 1291.2 }, offerStatus: st() }, 'vendido'],
  ['totalBids ausente', { winnerBid: {}, endDateTime: 1790129760000, offerDetail: {}, offerStatus: st() }, 'indeterminado'],
  ['ainda aberto', { totalBids: 0, endDateTime: 1790300000000, offerDetail: {}, offerStatus: st() }, 'em_andamento'],
];
const agora = Date.parse('2026-09-23T16:00:00Z');
for (const [nome, of, esperado] of casos) {
  const r = classificarOferta(of, agora);
  assert.equal(r.resultado, esperado, nome);
  console.log(`ok  ${nome} → ${r.resultado}`);
}
assert.equal(classificarOferta(casos[5][1], agora).valor, 1500);
console.log('superbid-resultado: todos os casos passaram');
