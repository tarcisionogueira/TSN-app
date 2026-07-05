// Extrai do CABEÇALHO da matrícula (texto do PDF) o cartório/serventia de Registro
// de Imóveis, o ofício, a comarca e o número da matrícula. Heurístico e tolerante:
// devolve só os campos que casarem, ou null. Compartilhado entre o cron de
// backfill (scripts/enriquecer-cartorio-matricula.mjs) e o enriquecimento on-view
// (api/enriquecer-lote.js), para uma única lógica de extração.

const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;\-\s]+$/, '');

export function extrairRegistroMatricula(txt) {
  if (!txt) return null;
  const t = String(txt).replace(/\s+/g, ' ').slice(0, 6000);
  const f = {};
  // Cartório / Serventia de Registro de Imóveis (com ofício/circunscrição).
  let m = t.match(/(\d+[ºªo°]?\s*(?:of[íi]cio|circunscri[çc][ãa]o|servi[çc]o registral|cart[óo]rio)[^.\n;]{0,70}?registr(?:o|al) de im[óo]veis[^.\n;]{0,40})/i)
       || t.match(/((?:oficial|of[íi]cio|cart[óo]rio|serventia|servi[çc]o)[^.\n;]{0,25}registr(?:o|al) de im[óo]veis[^.\n;]{0,50})/i)
       || t.match(/(registr(?:o|al) de im[óo]veis[^.\n;]{0,55})/i);
  if (m) {
    // Corta o que vier depois do cabeçalho do cartório (nº da matrícula, livro…).
    const c = limpar(m[1]).split(/\bmatr[íi]cula\b|\blivro\b|\bficha\b|\bregistro geral\b|\bn[º°]\s*\d/i)[0];
    f.cartorio = limpar(c).slice(0, 90);
  }
  // Comarca / município do registro.
  m = t.match(/comarca\s+de\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,45}?)(?=\s*[-–,\/;]|\s+estado|\s+e\s+o?\s|\.|$)/i)
   || t.match(/munic[íi]pio\s+de\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,45}?)(?=\s*[-–,\/;]|\s+estado|\.|$)/i);
  if (m) f.comarca = limpar(m[1]);
  // Número do ofício.
  m = t.match(/(\d+)\s*[ºªo°]\s*of[íi]cio/i);
  if (m) f.oficio = `${m[1]}º Ofício`;
  // Número da matrícula.
  m = t.match(/matr[íi]cula[\s:º°n.\-]*([\d.]{2,12}\d|\d{2,8})/i);
  if (m) { const num = m[1].replace(/\.+$/, ''); if (/\d/.test(num)) f.matricula = num; }
  return Object.keys(f).length ? f : null;
}
