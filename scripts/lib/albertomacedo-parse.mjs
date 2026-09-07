/**
 * Parser puro — ALBERTOMACEDOLEILOES (albertomacedoleiloes.com.br). Fonte `dom`, plataforma
 * própria (recon 07/09). Sem catálogo de LOTES separado — a home lista os "leilões"
 * (`/leilao/<slug>`), e cada um pode ser um imóvel único ("terreno-de-3-hectares-em-barretos",
 * confirmado: tabela limpa de praças) OU um pacote com vários imóveis em UF diferentes
 * ("sicoob-imoveis-em-mg-e-pe", "imoveis-em-ba-mg-e-pr" — plural, várias siglas no slug).
 * NÃO dá pra distinguir os dois só pela URL — o parser tenta extrair o rótulo "Avaliação" de
 * qualquer jeito; se a página for um pacote sem um valor único, `checarQualidade` descarta
 * por `valor_avaliacao` zerado (mais seguro que inventar qual dos vários imóveis é "o" valor).
 *
 * Confirmado (leilao/terreno-de-3-hectares-em-barretos): tabela PRAÇA/ABERTURA/ENCERRAMENTO
 * /INICIAL (1ª e 2ª praça) + rótulo solto "Avaliação (FEVEREIRO de 2025): R$ 1.082.794,61".
 * Sem PDF encontrado no recon (real ou apenas fora da janela capturada — a checar num
 * dry-run); fotos reais via API própria (api.albertomacedoleiloes.com.br/storage/...).
 */
import { inferirTipo, cidadeUF, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, anexosDeHtml, montarRowDom, linhasDeTabela } from './dom-parse-util.mjs';

export const TENANTS = {
  albertomacedo: { fonte: 'ALBERTOMACEDOLEILOES', leiloeiro: 'Alberto Macedo Leilões', base: 'https://albertomacedoleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/leilao\/([a-z0-9][a-z0-9-]{2,})?)\/?["']/gi)) {
    if (!m[2]) continue;   // "/leilao/-1" e afins: sem slug de verdade, nada pra identificar
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/leilao\/([a-z0-9-]+)/i) || [])[1] || null;

// Tabela de praças: pega a ÚLTIMA linha com valor em R$ na coluna final (2ª praça = mínimo
// vigente); a 1ª linha de dados vira avaliação de reserva se não houver rótulo "Avaliação".
function precosDaTabela(html) {
  const linhas = linhasDeTabela(html).filter((cols) => cols.some((c) => /R\$/.test(c)));
  if (!linhas.length) return { primeira: 0, ultima: 0 };
  const valorDaLinha = (cols) => plaus(num((cols.find((c) => /R\$/.test(c)) || '').match(/R\$\s*([\d.]+,\d{2})/)?.[1] || ''));
  return { primeira: valorDaLinha(linhas[0]), ultima: valorDaLinha(linhas[linhas.length - 1]) };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = idDaUrl(url) || '';
  const { primeira, ultima } = precosDaTabela(html);

  const avalExplicita = plaus(num((txt.match(/Avalia[çc][ãa]o\s*(?:\([^)]*\))?\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  let avaliacao = avalExplicita || primeira;
  let minimo = ultima || avaliacao;
  if (!avaliacao) avaliacao = minimo;
  // GUARDA (07/09): a home mistura "leilões" de imóvel com veículo sob a MESMA URL
  // /leilao/<slug> ("fiatpalio-weekend-ex" entrou na 1ª rodada real com avaliação de
  // R$13.337 — carro, não imóvel). Sem nenhuma palavra de imóvel no corpo, o valor não é de
  // um imóvel; zera pra o checarQualidade descartar (mesmo caminho dos pacotes multi-imóvel).
  if (!/matr[íi]cula|im[óo]vel|terreno|apartamento|\bcasa\b|\b[áa]rea\b|\bm[²2]\b|rural|sobrado/i.test(txt)) {
    avaliacao = 0; minimo = 0;
  }

  const titulo = tituloDeSlug(slug);
  const { cidade, estado } = cidadeUF(titulo || '', txt.slice(0, 1500));
  const area = extrairArea(titulo || '', txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial|processo\s*n/i.test(txt) ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
