// PARCELAMENTO NO CARTÃO — uma conta só para a tela (PagamentoServico, vitrines) e para o servidor (api/mp-checkout.js).
//
// 07/11 (dono): "precisa trazer as taxas reais de cobrança de cada gateway". Até aqui a conta usava uma tabela
// NOSSA (2,49%–3,49% ao ano) e mostrava 12× de R$ 6.000 = R$ 6.209,40. A API do Mercado Pago, para a nossa conta,
// cobra do cliente 22,11% no 12× = R$ 7.326,60 — e quem soma esses juros é o PRÓPRIO MP, por cima do valor
// enviado (payer_costs.installment_rate > 0). Agora:
//  · os juros vêm da tabela `gateway_taxas` (API do MP → observado nos pagamentos reais), via /api/gateway-taxas,
//    e na tela de pagamento, assim que o cartão é digitado, da própria API do MP para aquele cartão;
//  · TAXAS_MP_REFERENCIA abaixo é só a referência de 07/11 para quando nada disso responde (nunca some o número).
//
// Duas situações, e o valor que vai ao MP é diferente em cada uma:
//  · CLIENTE ASSUME (n > semJurosAte): o servidor envia o valor cheio e o MP soma os juros → total = v × (1 + j).
//  · SEM JUROS (1 < n ≤ semJurosAte): a BidPro absorve → o servidor envia v / (1 + j) para que o total pago pelo
//    cliente, já com os juros do MP, seja o próprio v. É `valorAEnviar`.

// % de juros que o MP soma ao cliente por nº de parcelas (API payment_methods/installments, R$ 6.000, 07/11 —
// iguais para Visa, Master, Elo e Amex).
export const TAXAS_MP_REFERENCIA = Object.freeze({
  1: 0, 2: 9.64, 3: 11.23, 4: 11.36, 5: 14.31, 6: 14.32, 7: 16.72, 8: 16.73, 9: 19.69, 10: 20.65, 11: 20.66, 12: 22.11,
});

const centavos = (v) => Math.round(Number(v) * 100) / 100;
const paraCima = (v) => Math.ceil(Math.round(Number(v) * 1000) / 10) / 100;

/** % de juros do cliente para `n` parcelas, da tabela informada (ou a de referência). */
export function jurosCliente(n, taxas = null) {
  const k = Math.max(1, Math.floor(Number(n) || 1));
  const t = taxas && taxas[k] != null ? Number(taxas[k]) : TAXAS_MP_REFERENCIA[k];
  return Number.isFinite(t) && t >= 0 ? t : null;
}

/**
 * { parcela, total, comJuros, pctJuros } que o CLIENTE paga em `n` parcelas de `valor`, sem juros até `semJurosAte`.
 * `taxas` = { [n]: % de juros do cliente } (de /api/gateway-taxas ou da API do MP para o cartão digitado).
 */
export function parcelamento(valor, n, semJurosAte = 1, taxas = null) {
  const v = Number(valor) || 0;
  const k = Math.max(1, Math.min(12, Math.floor(Number(n) || 1)));
  if (k === 1 || k <= Math.max(1, Number(semJurosAte) || 1)) return { parcela: centavos(v / k), total: centavos(v), comJuros: false, pctJuros: 0 };
  const j = jurosCliente(k, taxas) ?? 0;
  const total = centavos(v * (1 + j / 100));
  return { parcela: centavos(total / k), total, comJuros: j > 0, pctJuros: j };
}

/**
 * Quanto o servidor manda ao Mercado Pago como `transaction_amount` para o cliente pagar o que a tela mostrou.
 * Cliente assume → o valor cheio (o MP soma os juros). Sem juros → v / (1 + j), arredondado para CIMA no centavo
 * (o cliente nunca paga menos que v por arredondamento; a diferença, a menor, é a BidPro absorvendo os juros).
 */
export function valorAEnviar(valor, n, semJurosAte = 1, taxas = null) {
  const v = Number(valor) || 0;
  const k = Math.max(1, Math.floor(Number(n) || 1));
  if (k === 1 || k > Math.max(1, Number(semJurosAte) || 1)) return centavos(v);
  const j = jurosCliente(k, taxas);
  if (j == null) return null; // sem taxa conhecida não dá para prometer "sem juros"
  return paraCima(v / (1 + j / 100));
}

/** Texto curto para vitrines: "em até 12× sem juros" / "em até 12× (sem juros até 3×)" / "em até 12× com juros do cartão". */
export function textoParcelamento(parcelasMax = 12, semJurosAte = 1) {
  const max = Math.max(1, Math.min(12, Number(parcelasMax) || 1));
  const sj = Math.max(1, Math.min(max, Number(semJurosAte) || 1));
  if (max === 1) return 'à vista';
  if (sj >= max) return `em até ${max}× sem juros`;
  if (sj > 1) return `em até ${max}× (sem juros até ${sj}×)`;
  return `em até ${max}× com juros do cartão`;
}
