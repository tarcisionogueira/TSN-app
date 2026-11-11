// DATA BRASILEIRA ("09/10/2026") → ISO ("2026-10-09"). Por que existe (06/10, Alphaville): a data do
// pregão lida do edital chegava como texto BR e `new Date("09/10/2026")` a lê no padrão AMERICANO
// (mês/dia) → 10/09. O lote foi declarado "encerrado em 10/09" a 4 dias do leilão, a geração foi
// recusada e a retenção (15 dias após o leilão) apagaria a análise. Usado na tela e no servidor.
export function dataBrParaIso(v) {
  if (v == null) return v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D|$)/);
  if (!m) return s;
  const [, dd, mm, aaaa] = m;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${aaaa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// DATA POR EXTENSO → dd/mm/aaaa (11/11, caso Cravo 12733, Feira de Santana). O edital dizia "1º Leilão
// no dia 21 de janeiro de 2027" e "2º Leilão no dia 28 de janeiro de 2027"; todos os leitores de praça
// do sistema só reconhecem "dd/mm/aaaa", então o edital foi lido SEM DATA NENHUMA — e a data errada do
// acervo (09/03/2027) passou pelos dois relatórios sem comparação e sem anomalia. Em vez de ensinar
// cada leitor, o texto do documento é normalizado na entrada: "21 de janeiro de 2027", "1º de março de
// 2027", "21 de jan. de 2027", "21.01.2027" e "21-01-2027" viram "21/01/2027". Puro, sem efeito colateral
// fora das datas; formatos que já eram "dd/mm/aaaa" ficam como estão.
const MESES = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};
const p2 = (n) => String(n).padStart(2, '0');
export function normalizarDatasPorExtenso(texto) {
  if (!texto) return texto;
  let t = String(texto);
  t = t.replace(
    /\b(\d{1,2})\s*(?:[ºo°]\s*)?(?:\(\s*[a-zçãéêíóôú\s]+\s*\)\s*)?de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s+de\s+(\d{4})\b/gi,
    (todo, d, mes, a) => {
      const n = MESES[mes.toLowerCase().replace('ç', 'c')];
      const dia = Number(d);
      return n && dia >= 1 && dia <= 31 ? `${p2(dia)}/${p2(n)}/${a}` : todo;
    });
  // dd.mm.aaaa / dd-mm-aaaa (sem tocar em número de processo: exige dia ≤ 31, mês ≤ 12 e ano 19xx/20xx).
  t = t.replace(/\b(\d{2})[.-](\d{2})[.-]((?:19|20)\d{2})\b(?![.-]\d)/g, (todo, d, m, a) =>
    (Number(d) >= 1 && Number(d) <= 31 && Number(m) >= 1 && Number(m) <= 12 ? `${d}/${m}/${a}` : todo));
  return t;
}

// Para gravar em coluna timestamptz: ISO completo ou null (nunca uma data lida no padrão americano).
export function dataLeilaoIso(v) {
  const s = dataBrParaIso(v);
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00-03:00` : s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
