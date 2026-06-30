/**
 * Dias úteis (seg–sex), em UTC. Não considera feriados — aproximação suficiente
 * para os prazos internos do jurídico (7 dias úteis para devolutiva).
 */
export function addDiasUteis(date, n) {
  const d = new Date(date);
  let add = 0;
  while (add < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) add++;
  }
  return d;
}

// Quantos dias úteis completos se passaram entre `inicio` e `fim`.
export function diasUteisEntre(inicio, fim) {
  const a = new Date(inicio); a.setUTCHours(0, 0, 0, 0);
  const b = new Date(fim); b.setUTCHours(0, 0, 0, 0);
  if (b <= a) return 0;
  let count = 0;
  const d = new Date(a);
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}
