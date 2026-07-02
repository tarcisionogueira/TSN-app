/**
 * Score BidPro — nota 0–10 de potencial de oportunidade do imóvel de leilão.
 *
 * Inspirado no IPL (Índice de Potencial de Lucro) do mercado, adaptado ao que a
 * BidPro tem de dado CONFIÁVEL na listagem:
 *  - MARGEM (65%): desconto do lance mínimo vs. avaliação. É o sinal sempre
 *    disponível. 0% → ~2, 30% → ~6, 55%+ → 10 (satura; fora da faixa é clampado).
 *  - RISCO (35%): só entra quando o imóvel já tem análise (score jurídico/financeiro).
 *    Enquanto não há análise, a nota é só de margem (base='margem') e refina depois.
 *
 * Retorna null quando não há nem desconto nem análise (nada a pontuar).
 */
function norm10(v) {
  const n = Number(v);
  if (isNaN(n)) return null;
  return n > 10 ? n / 10 : n; // aceita escala 0–100 ou 0–10
}

export function scoreBidPro({ desconto, scoreJuridico, scoreFinanceiro } = {}) {
  const d = Number(desconto);
  let margem = null;
  if (!isNaN(d)) {
    const c = Math.max(0, Math.min(60, d));
    margem = 2 + (c / 60) * 8; // 0%→2, 60%→10
  }

  const sj = norm10(scoreJuridico);
  const sf = norm10(scoreFinanceiro);
  const riscos = [sj, sf].filter((v) => v != null);
  const risco = riscos.length ? riscos.reduce((a, b) => a + b, 0) / riscos.length : null;

  if (margem == null && risco == null) return null;

  let nota, base;
  if (margem != null && risco != null) { nota = 0.65 * margem + 0.35 * risco; base = 'completo'; }
  else if (margem != null) { nota = margem; base = 'margem'; }
  else { nota = risco; base = 'risco'; }

  nota = Math.max(0, Math.min(10, Math.round(nota * 10) / 10));
  const cor = nota >= 7 ? '#16a34a' : nota >= 4 ? '#d97706' : '#dc2626';
  return { nota, base, cor };
}

// Rótulo curto do que a nota representa (para tooltip/legenda).
export function scoreLabel(base) {
  if (base === 'completo') return 'Margem + risco da análise';
  if (base === 'risco') return 'Risco da análise';
  return 'Potencial por margem (refina após análise)';
}
