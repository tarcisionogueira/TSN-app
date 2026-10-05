/**
 * Parser puro — título de VEÍCULO da Leilão VIP (05/10). O título é texto livre do comitente, não o
 * padrão "MARCA/MODELO, ANO AAAA/AAAA" do Detran que `marcaModeloAno` lê. Seco de 05/10: marca em
 * 10/21 e ano em 2/21. Formas reais:
 *   "Ford, Modelo Courier 1.6 Flex, Ano 2008" · "Motocicleta Yamaha, XTZ250 Lander, ano 2020"
 *   "FIAT PALIO FIRE - ANO 15/16" · "Chevrolet, Modelo D10/1000, Ano 1979"
 * Ano único = ano-MODELO; fabricação fica sem (mesma convenção do Astavero — não inventa).
 */
import { marcaModeloAno, RE_MARCA } from './nordeste-veiculo.mjs';

const RE_TIPO = /^(ve[íi]culo|autom[óo]vel|motocicleta|motoneta|ciclomotor|moto|caminh[ãa]o|caminhonete|camioneta|utilit[áa]rio|van|[ôo]nibus)\b\s*:?\s*/i;
const ano4 = (s) => { const n = Number(s); return s.length === 2 ? (n > 50 ? 1900 + n : 2000 + n) : n; };
const valido = (n) => n >= 1950 && n <= 2049;

export function marcaModeloAnoVIP(titulo) {
  const t = String(titulo || '').replace(/\s+/g, ' ').trim();
  const a = t.match(/\bano\s*:?\s*(\d{4}|\d{2})(?:\s*\/\s*(\d{4}|\d{2}))?\b/i);
  let fab = null, mod = null;
  if (a) {
    const x = ano4(a[1]), y = a[2] ? ano4(a[2]) : null;
    if (valido(x) && (y == null || valido(y))) { if (y) { fab = x; mod = y; } else mod = x; }
  }
  const corpo = t.replace(RE_TIPO, '').split(/[\s,–-]*\bano\b/i)[0].trim();
  const m = corpo.match(/^([A-Za-zÀ-ú.]+)\s*[,/\s]\s*(.+)$/);
  if (!m || !RE_MARCA.test(m[1].replace(/\.$/, ''))) {
    const base = marcaModeloAno(t);
    return { ...base, ano_fabricacao: base.ano_fabricacao ?? fab, ano_modelo: base.ano_modelo ?? mod };
  }
  const marca = m[1].toUpperCase().replace(/^VW$/, 'VOLKSWAGEN').replace(/^GM$/, 'CHEVROLET').replace(/^M\.?BENZ$/, 'MERCEDES-BENZ');
  const modelo = m[2].replace(/^modelo\s*:?\s*/i, '').replace(/[\s,;.–-]+$/, '').trim() || null;
  return { marca, modelo: modelo ? modelo.slice(0, 80) : null, ano_fabricacao: fab, ano_modelo: mod };
}
