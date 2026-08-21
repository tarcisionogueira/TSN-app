/**
 * Parser puro — ALFA (alfaleiloes.com.br, SPA genérica). Fonte `dom`: o HTML cru é shell
 * de 8KB; TUDO abaixo espera o HTML RENDERIZADO (motor fetch-dom).
 *
 * ESTRUTURA (recons 20-21/08):
 *   • Catálogo de IMÓVEIS: /imoveis renderizado — 11 lotes /lote/<id>/<slug>/ (a home
 *     mistura veículos; /imoveis não).
 *   • Detalhe renderizado, POR RÓTULO: "Valor da Avaliação: R$ …" · "Lance Mínimo: R$ …"
 *     · "Débito Exequendo" (IGNORAR). Depois vem um carrossel de OUTROS lotes com os
 *     próprios "LANCE MÍNIMO" — só a 1ª ocorrência de cada rótulo é do lote aberto.
 *   • Slug carrega tipo+cidade+UF: "leilao-de-fazenda-em-manhumirim-mg".
 *   • Sem API escondida (XHR só /filters/, 2.8KB de filtros).
 */
import { inferirTipo, cidadeUF, extrairArea, estaEncerrado, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { textoDe, valorPorRotulo, tituloDeSlug, cidadeUFDeSlug, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  alfa: { fonte: 'ALFA', leiloeiro: 'Alfa Leilões', base: 'https://www.alfaleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/lote\/(\d+)\/[a-z0-9-]+\/?)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

const slugDa = url => (String(url).match(/\/lote\/\d+\/([a-z0-9-]+)/i) || [])[1] || '';

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = slugDa(url);

  let avaliacao = valorPorRotulo(txt, /Valor\s+da\s+Avalia[çc][ãa]o/i);
  let minimo = valorPorRotulo(txt, /Lance\s+M[íi]nimo/i);
  if (!minimo) minimo = avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const titulo = tituloDeSlug(slug);
  const deSlug = cidadeUFDeSlug(slug);
  const { cidade, estado } = deSlug.cidade ? deSlug : cidadeUF('', txt.slice(0, 2500));

  // Área: só do começo do texto (a seção do lote); o carrossel vem depois.
  const area = extrairArea(titulo || '', '') || extrairArea(txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /judicial|processo\s*n|d[ée]bito\s+exequendo/i.test(txt) ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 2500)),
    numero_matricula: mat, ...docs,
    encerrado: estaEncerrado(txt.slice(0, 2500)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
