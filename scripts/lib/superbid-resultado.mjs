/**
 * Resultado de uma oferta SUPERBID/SOLD a partir do JSON da offer-query (23/09/2026).
 *
 * Regra medida sobre 5 ofertas encerradas (fixture em scripts/testes/superbid-resultado.mjs):
 * `offerStatus.sold` veio false em TODAS e `currentMaxBid` = mínimo em todas — nenhum dos dois
 * separa nada. O que separa é `totalBids` + `winnerBid` + `reservedPrice`:
 *   • 3 lotes que o cron da Vercel marcara "vendido" (regex na página) tinham totalBids=0;
 *   • lance único ABAIXO da reserva (4977027: 1.473 × 1.820) = venda condicional, depende do
 *     comitente aceitar — não é vendido nem sem lance.
 * Só 'vendido' e 'sem_lance' viram resultado gravado; o resto fica indeterminado.
 */
export function sinaisDaOferta(of) {
  const s = of?.offerStatus || {};
  const d = of?.offerDetail || {};
  return {
    sold: s.sold === true || Number(of?.quantitySold) > 0,
    removido: s.removed === true,
    fechadoLances: s.closedToBids === true || s.closed === true,
    fimMs: Number(of?.endDateTime) || Date.parse(String(of?.endDate || '').replace(' ', 'T') + '-03:00') || null,
    lances: typeof of?.totalBids === 'number' ? of.totalBids : null,
    recebeuLanceOuProposta: of?.hasReceivedBidsOrProposals === true,
    vencedor: !!of?.winnerBid?.currentWinner,
    max: Number(d.currentMaxBid ?? NaN),
    reserva: Number(d.reservedPrice ?? NaN),
    statusCode: s.statusCode ?? null,
  };
}

export function classificarOferta(of, agoraMs = Date.now()) {
  const c = sinaisDaOferta(of);
  if (c.sold) return { resultado: 'vendido', valor: c.max > 0 ? c.max : null, c };
  const encerrou = (c.fimMs && c.fimMs < agoraMs - 3600e3) || c.fechadoLances;
  if (!encerrou) return { resultado: 'em_andamento', c };
  if (c.removido) return { resultado: 'retirado', c };            // saiu antes do fim
  if (c.lances === null) return { resultado: 'indeterminado', c }; // campo ausente ≠ zero lances
  if (c.lances === 0 && !c.recebeuLanceOuProposta) return { resultado: 'sem_lance', c };
  if (c.lances > 0 && c.vencedor) {
    if (Number.isFinite(c.reserva) && c.reserva > 0 && Number.isFinite(c.max) && c.max < c.reserva) return { resultado: 'condicional', c };
    return { resultado: 'vendido', valor: c.max > 0 ? c.max : null, c };
  }
  return { resultado: 'indeterminado', c };
}
