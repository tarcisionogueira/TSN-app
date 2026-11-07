// PARCELAMENTO NO CARTÃO — uma conta só para a tela (PagamentoServico) e para o servidor (api/mp-checkout.js).
// 07/11 (dono): o padrão é o CLIENTE assumir os juros a partir da 2ª parcela; cada cobrança avulsa pode definir
// até quantas parcelas aceita e até quantas são sem juros. Antes a tela calculava os juros e o servidor da cobrança
// avulsa cobrava o saldo puro — o número mostrado não era o cobrado.
//
// Taxa ao ano por faixa de parcelas, aplicada pro rata (n/12) — a mesma tabela que a tela já usava desde 18/09.
export const TAXA_ANO_POR_FAIXA = (n) => (n <= 6 ? 0.0249 : n <= 9 ? 0.0299 : 0.0349);

const centavos = (v) => Math.round(Number(v) * 100) / 100;

/** { parcela, total, comJuros } para `n` parcelas de `valor`, sem juros até `semJurosAte`. */
export function parcelamento(valor, n, semJurosAte = 1) {
  const v = Number(valor) || 0;
  const k = Math.max(1, Math.min(12, Math.floor(Number(n) || 1)));
  if (k <= Math.max(1, Number(semJurosAte) || 1)) return { parcela: centavos(v / k), total: centavos(v), comJuros: false };
  const total = centavos(v * Math.pow(1 + TAXA_ANO_POR_FAIXA(k), k / 12));
  return { parcela: centavos(total / k), total, comJuros: true };
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
