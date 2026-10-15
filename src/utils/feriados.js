// FERIADOS BANCÁRIOS NACIONAIS (15/10, dono: data de pagamento da parcela que cai em fim de semana ou feriado
// é ANTECIPADA para o dia útil anterior). Fixos da Lei 662/1949 e alterações, mais os móveis da Páscoa em que os
// bancos não abrem: Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi. Carnaval e Corpus Christi não
// são feriados nacionais por lei, mas o banco fecha — e é no banco que a guia se paga (decisão do dono, 15/10).
// Puro (sem rede): usado pela tela e pelo servidor (src/utils/parcelamentoArremate.js).
const iso = (d) => d.toISOString().slice(0, 10);
const deIso = (s) => { const [a, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const somarDias = (dataIso, n) => { const d = deIso(dataIso); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(ano, mes - 1, dia)));
}

const cache = new Map();
export function feriadosBancarios(ano) {
  if (cache.has(ano)) return cache.get(ano);
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'].map((md) => `${ano}-${md}`);
  if (ano >= 2024) fixos.push(`${ano}-11-20`); // Consciência Negra (Lei 14.759/2023)
  const s = new Set([...fixos, somarDias(p, -48), somarDias(p, -47), somarDias(p, -2), somarDias(p, 60)]);
  cache.set(ano, s);
  return s;
}

export function ehDiaUtil(dataIso) {
  const dow = deIso(dataIso).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !feriadosBancarios(Number(String(dataIso).slice(0, 4))).has(String(dataIso).slice(0, 10));
}

// Mesmo dia se útil; senão o dia útil ANTERIOR (nunca empurra para depois do vencimento).
export function diaUtilAnteriorOuIgual(dataIso) {
  let d = String(dataIso).slice(0, 10);
  for (let i = 0; i < 15 && !ehDiaUtil(d); i++) d = somarDias(d, -1);
  return d;
}

export { somarDias };
