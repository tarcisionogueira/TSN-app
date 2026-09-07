/**
 * Parser puro — ROCHALEILOES (rochaleiloes.com.br). Fonte `dom`, plataforma própria (recon
 * 07/09, GitHub Actions). Catálogo real em /imoveis?page=N (paginação confirmada: página 2
 * trouxe lotes DIFERENTES da 1ª — Biguaçu/SC, Loanda/PR, Terra Rica/PR, Videira/SC,
 * Itapema/SC). Detalhe em /lote/<id> — SEM slug (só ID numérico), então título/cidade vêm
 * inteiramente do corpo, não da URL.
 *
 * Rótulo solto, confirmado no lote 43259:
 *   "LOTE RETIRADO
 *    Lance inicial: R$ 3.607.743,75
 *    CURITIBA - PR
 *    LEILÃO ID 6124 / LOTE 1 / IMÓVEL RURAL
 *    Avaliação: R$ 7.215.487,50
 *    1º Leilão: 17/08/2026 - 09:45h - R$ 7.215.487,50
 *    2º Leilão: 08/09/2026 - 09:45h - R$ 3.607.743,75"
 * "LOTE RETIRADO" é um status de desfecho (lote puxado do leilão pelo credor/executado) —
 * conta como encerrado, senão o relatório oferece um lote que não está mais em jogo.
 * Cidade/UF vem em MAIÚSCULA com hífen ("CURITIBA - PR"), formato diferente do "Cidade/UF"
 * usado em outras fontes — por isso o regex próprio em vez de reusar cidadeUFDeSlug/cidadeUF.
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { valorPorRotulo, textoDe, textoComLinhas, titleCase, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  rocha: { fonte: 'ROCHALEILOES', leiloeiro: 'Rocha Leilões', base: 'https://rochaleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/lote\/(\d+))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

function cidadeUFDoTexto(linhas) {
  for (const l of linhas.slice(0, 15)) {
    const m = l.match(/^([A-ZÀ-Ÿ][A-ZÀ-Ÿ ]{2,35})\s*-\s*([A-Z]{2})$/);
    if (m) return { cidade: titleCase(m[1].trim()), estado: m[2] };
  }
  return { cidade: null, estado: null };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const linhas = textoComLinhas(html).split('\n');
  const { cidade, estado } = cidadeUFDoTexto(linhas);

  const retirado = /\bLOTE\s+RETIRADO\b/i.test(txt);
  let avaliacao = valorPorRotulo(txt, /Avalia[çc][ãa]o/i);
  const minimoLance = valorPorRotulo(txt, /Lance\s+inicial/i);
  let minimo = minimoLance || avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const tipoLinha = linhas.find(l => /^(IM[ÓO]VEL|CASA|APARTAMENTO|TERRENO|COMERCIAL)\b/i.test(l)) || '';
  const loteMatch = txt.match(/\bLOTE\s+(\d+)\b/i);
  const titulo = [tipoLinha ? titleCase(tipoLinha) : null, cidade && estado ? `${cidade}/${estado}` : null, loteMatch ? `Lote ${loteMatch[1]}` : null]
    .filter(Boolean).join(' - ').slice(0, 180) || null;

  const area = extrairArea(titulo || '', txt.slice(0, 800));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : 'judicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: retirado || /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
