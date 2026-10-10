/**
 * Parser puro — LEJE (leje.com.br). Fonte `dom`, plataforma própria em PHP antigo (recon
 * 07/09). URL do lote é query string: `index.php?acao=evento&cod=<leilaoId>&lote=<loteId>` —
 * todo path de PATHS_PADRAO (/imoveis, /leiloes etc.) devolve BYTE A BYTE a MESMA home, com
 * os mesmos ~5 lotes em destaque; não há catálogo paginado confirmado, então o catálogo É a
 * home ("/"). Se um catálogo maior existir por trás de algum "ver todos" carregado por JS,
 * fica pra um recon futuro — o que a home mostra já são lotes REAIS, não é lote inventado.
 *
 * Detalhe (confirmado em 2 lotes reais) é RÓTULO LIMPO:
 *   "Tipo: Loja
 *    Valor de avaliação: R$ 310.000,00
 *    Valor de 2º leilão: R$ 124.000,00
 *    Matrícula nº: 106.698
 *    Processo nº: 0100309-16.2016.5.01.0034"
 * Cidade/UF vem do texto livre da descrição ("Rio de Janeiro/RJ"). NENHUM link .pdf apareceu
 * no HTML cru dos 2 lotes testados — "Edital"/"Documentos" são ABAS na página, prováveis de
 * carregar por clique/AJAX; `anexos` provavelmente sai vazio até um recon confirmar a URL real
 * dos arquivos — melhor não ter documento do que inventar um link que não existe.
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, textoComLinhas, titleCase, anexosDeHtml, montarRowDom, cidadeUFBare } from './dom-parse-util.mjs';

export const TENANTS = {
  leje: { fonte: 'LEJE', leiloeiro: 'LEJE — Leilão Judicial Eletrônico', base: 'https://leje.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  // O HTML cru vem com "&amp;" entre os parâmetros da query string — "&" sozinho (sem "amp;")
  // NUNCA precede "lote=" aqui, por isso o "amp;" opcional no meio do padrão.
  for (const m of String(html || '').matchAll(/href=["']([^"']*acao=evento[^"']*[?&](?:amp;)?lote=(\d+)[^"']*)["']/gi)) {
    try { urls.set(m[2], new URL(m[1].replace(/&amp;/g, '&'), base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => {
  try { return new URL(url).searchParams.get('lote'); } catch { return (String(url).match(/[?&]lote=(\d+)/) || [])[1] || null; }
};

// titleCase (dom-parse-util) só capitaliza depois de espaço/aspa/hífen — uma UF colada num
// "/" no fim do título ("...Janeiro/RJ") sai "Janeiro/rj". Separa a UF ANTES de titleCase e
// devolve maiúscula por fora.
function tituloComUf(linha) {
  const m = linha.match(/^(.*)\/([A-Z]{2})$/);
  if (!m) return titleCase(linha);
  return `${titleCase(m[1])}/${m[2]}`;
}

function tituloDaLinha(linhas) {
  const i = linhas.findIndex((l) => /^ID:\s*\d+/i.test(l));
  if (i < 0) return null;
  // A linha logo após "ID: NNNN" às vezes é só um contador de lances; a descrição real é a
  // 1ª linha em CAIXA ALTA (>15 chars) depois dela.
  for (let j = i + 1; j < Math.min(i + 4, linhas.length); j++) {
    const l = linhas[j];
    if (l.length > 15 && l === l.toUpperCase() && /[A-ZÀ-Ÿ]/.test(l)) return tituloComUf(l);
  }
  return null;
}

// DATA NO FORMATO DO LEJE (10/10, #195): "1º Leilão 16/NOV/26 - 11:30", "Início: 14/DEZ/26 - 14:00".
// `proximaData` só entende "16/11/2026" — todo lote LEJE saía sem data e NUNCA expirava (15 de 15
// ativos sem data, 12 parados há semanas). Lê só o BLOCO do lote (a partir da linha "ID: NNNN"):
// a página traz ~130 datas de OUTROS lotes nos "Destaques", e a primeira data da página não é a deste.
const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
export function datasLeje(bloco) {
  const out = [];
  for (const m of String(bloco || '').matchAll(/\b(\d{2})\/(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4}|\d{2})(?!\d)(?:\s*-\s*(\d{2}):(\d{2}))?/gi)) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    // Plausibilidade (10/10): a 1ª versão casava "20" de "2026" e gravou 2020 — o lote expirou na
    // hora. Ano de leilão anterior a 2025 é erro de leitura, nunca dado.
    if (Number(ano) < 2025) continue;
    out.push(`${ano}-${MES[m[2].toUpperCase()]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00`);
  }
  return [...new Set(out)].sort();
}
export function proximaDataLeje(bloco, agora = new Date()) {
  const ds = datasLeje(bloco);
  if (!ds.length) return null;
  return ds.find((d) => new Date(d) >= agora) || ds[ds.length - 1];
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const linhas = textoComLinhas(html).split('\n');
  // LOTE QUE SAIU DO AR (10/10): o LEJE redireciona a URL do lote para a HOME (200, título
  // "Leilão Judicial Eletrônico", sem a linha "ID: NNNN"). Parsear a home como lote devolvia um
  // lote vazio — o lote velho ficava ativo para sempre. Sem a linha do ID: "não é o lote".
  const iId = linhas.findIndex((l) => /^ID:\s*\d+/i.test(l));
  if (iId < 0) return null;
  const bruto = linhas.slice(iId, iId + 40).join(' ');
  const fimBloco = bruto.search(/\b(Destaques|Outros lotes|Veja tamb[ée]m|Lotes relacionados)\b/i);
  const bloco = fimBloco > 0 ? bruto.slice(0, fimBloco) : bruto;

  const avaliacao = plaus(num((txt.match(/Valor\s+de\s+avalia[çc][ãa]o\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const minimo = plaus(num((txt.match(/Valor\s+de\s+2[ºª°]?\s*leil[ãa]o\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1])) || avaliacao;

  const titulo = tituloDaLinha(linhas);
  const { cidade, estado } = cidadeUFBare(txt);
  const area = extrairArea(titulo || '', txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : 'judicial';
  const mat = (txt.match(/Matr[íi]cula\s*n[º°]?\s*:?\s*([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaDataLeje(bloco) || proximaData(bloco),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 1500)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
