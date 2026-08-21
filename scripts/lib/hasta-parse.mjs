/**
 * Parser puro — HASTA (hastaleilao.com.br, Flávio Costa; Vite SPA, agrega TRT-5/TJPE).
 * Fonte `dom`: TODO /lote/<id>/<slug> devolve o MESMO shell de 115KB no HTML cru (recon
 * 20/08 — os dois detalhes vieram byte-idênticos); o dado do lote só existe RENDERIZADO.
 * A enumeração da home também rende no DOM (18 lotes /lote/<ID>/<slug>).
 *
 * DETALHE (por rótulo, no texto renderizado):
 *   "1º LEILÃO dd/mm/aaaa às hh … Avaliação|Lance Inicial R$ X"  → avaliação
 *   "2º LEILÃO dd/mm/aaaa … Lance Inicial R$ Y"                  → lance mínimo
 *   "VENDA DIRETA" / "Processo nº" → modalidade · "matrícula nº 35.339" · "360m²".
 * Cidade: comarca do slug ("leilao-tjpe-comarca-de-sertania") ou do texto; UF pelo
 * tribunal (TJPE→PE, TRT-5/BA→BA) quando o texto não traz "Cidade/UF".
 */
import { inferirTipo, cidadeUF, extrairArea, estaEncerrado, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, textoDe, valorPorRotulo, tituloDeSlug, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  hasta: { fonte: 'HASTA', leiloeiro: 'Hasta Leilão (Flávio Costa)', base: 'https://www.hastaleilao.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/lote\/(\d+)\/[a-z0-9-]+)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  // SPA: alguns links vêm sem href estático — pesca também no texto de rotas absolutas.
  for (const m of String(html || '').matchAll(/["'](https?:\/\/[^"']*\/lote\/(\d+)\/[a-z0-9-]+)["']/gi)) {
    urls.set(m[2], m[1]);
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

const UF_TRIBUNAL = [
  [/tjpe|pernambuco/i, 'PE'],
  [/trt[\s-]*5|tjba|bahia/i, 'BA'],
  [/tjsp|s[ãa]o\s+paulo/i, 'SP'],
  [/tjal|alagoas/i, 'AL'], [/tjse|sergipe/i, 'SE'], [/tjpb|para[íi]ba/i, 'PB'],
];

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = (String(url).match(/\/lote\/\d+\/([a-z0-9-]+)/i) || [])[1] || '';

  // 1º leilão = avaliação (rótulo "Avaliação" explícito ganha); 2º leilão = mínimo.
  const m1 = txt.match(/1[º°ª]?\s*LEIL[ÃA]O[^R]{0,80}?(?:Avalia[çc][ãa]o|Lance\s+Inicial)[^R]{0,30}R\$\s*([\d.]+,\d{2})/i);
  const m2 = txt.match(/2[º°ª]?\s*LEIL[ÃA]O[^R]{0,80}?Lance\s+Inicial[^R]{0,30}R\$\s*([\d.]+,\d{2})/i);
  let avaliacao = valorPorRotulo(txt, /Avalia[çc][ãa]o/i) || plaus(num(m1?.[1]));
  let minimo = plaus(num(m2?.[1])) || avaliacao;
  if (!avaliacao) avaliacao = minimo;

  // Cidade: "Comarca de <cidade>" (texto ou slug); UF do par Cidade/UF ou do tribunal.
  let { cidade, estado } = cidadeUF('', txt.slice(0, 3000));
  if (!cidade) {
    const cm = txt.match(/comarca\s+de\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ' -]{2,40}?)(?:\s*[-–/,]|\s{2}|$)/i)
      || slug.match(/comarca-de-([a-z-]+)/i);
    if (cm) cidade = titleCase(String(cm[1]).replace(/-/g, ' ').trim()).slice(0, 60);
  }
  if (!estado) for (const [re, uf] of UF_TRIBUNAL) if (re.test(slug) || re.test(txt.slice(0, 3000))) { estado = uf; break; }

  const area = extrairArea(txt.slice(0, 2500));
  const modalidade = /venda\s*direta/i.test(txt) ? 'venda_direta'
    : /processo\s*n|\bju[íi]z\b|judicial/i.test(txt) && !/extrajudicial/i.test(txt) ? 'judicial' : 'judicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo: tituloDeSlug(slug), cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: estaEncerrado(txt.slice(0, 3000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
