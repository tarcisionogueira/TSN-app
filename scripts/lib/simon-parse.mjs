/**
 * Parser puro — SIMONLEILOES (simonleiloes.com.br). Fonte `dom`, plataforma própria (recon
 * 07/09). Catálogo confirmado em /leiloes/imoveis ("62 oportunidades encontradas", texto
 * repetido por lote: "RECEBENDO LANCES / Imóvel Rural / Matos Costa/SC / 1º leilão: DATA /
 * Lance inicial: R$ X / 2º leilão: DATA / Lance inicial: R$ Y / Comitente / Leilão S-NNN").
 * Paginação NÃO confirmada ao vivo (`pagina` é ponto de partida, mesma convenção da maioria
 * das fontes desta base).
 *
 * DETALHE (/lotes/<slug>, sem ID separado — o slug já é o identificador) tem fraseado
 * INFORMAL, não rótulo limpo: "Sendo o lote avaliado em R$ 450.000,00" (e, quando o lote tem
 * mais de uma construção, repete: "avaliada em R$ 750.000,00" para a segunda). O recon só
 * capturou os 1ºs 2500 de 7854 chars da página — não deu pra confirmar se "Lance inicial"/
 * datas de praça aparecem mais adiante; o parser tenta achá-los com janela larga e cai para
 * avaliação=mínimo se não achar (honesto, não inventa desconto).
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, anexosDeHtml, montarRowDom, cidadeUFBare } from './dom-parse-util.mjs';

export const TENANTS = {
  simon: { fonte: 'SIMONLEILOES', leiloeiro: 'Simon Leilões', base: 'https://simonleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/lotes\/([a-z0-9][a-z0-9-]{4,}))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lotes\/([a-z0-9-]+)/i) || [])[1] || null;

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = idDaUrl(url) || '';

  // "avaliad[oa] em R$ X" — pega a 1ª ocorrência (lote principal; construções extras vêm depois).
  let avaliacao = plaus(num((txt.match(/avaliad[oa]\s+em\s+R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  // Janela larga: não sabemos se "Lance inicial"/praça está perto do rótulo de avaliação
  // nesta plataforma (o recon não alcançou essa parte da página).
  const minimoRe = /Lance\s*inicial[^]{0,300}?R\$\s*([\d.]+,\d{2})/i;
  let minimo = plaus(num((txt.match(minimoRe) || [])[1]));
  // GUARDA (07/09, achado na 1ª rodada real): janela de 300 chars é larga o bastante pra
  // pular do fim da avaliação deste lote e pegar um "Lance inicial" de OUTRO lugar da página
  // (carrossel de relacionados, FAQ). Sintoma visto: mínimo MAIOR que avaliação (desconto
  // negativo) — fisicamente impossível num leilão de deságio. Nesse caso o valor não é
  // confiável; cai pra avaliação (nunca inventa um número, só descarta o que não bate).
  if (minimo && avaliacao && minimo > avaliacao) minimo = avaliacao;
  if (!minimo) minimo = avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const titulo = tituloDeSlug(slug);
  const { cidade, estado } = cidadeUFBare(txt);
  const area = extrairArea(titulo || '', txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial|processo\s*n/i.test(txt) ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 4000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
