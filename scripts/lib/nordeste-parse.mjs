/**
 * Parser puro — NORDESTE (nordesteleiloes.com.br, Next.js App Router/RSC). Fonte `dom`
 * com enumeração em DOIS NÍVEIS (recons 20-21/08): a home renderizada lista EVENTOS
 * (/leiloes/<id>-<slug>, varas federais/TRT-5) e cada evento lista os LOTES
 * (/lotes/<evento>-<seq>-<slug>). Sem API: 0 XHR de lote interceptável (RSC no documento).
 *
 * O SLUG do lote é rico: "128-001-imovel-rural-com-46-hectares-amargosa-bahia" →
 * tipo, área (m2 ou hectares), cidade e ESTADO POR EXTENSO. Datas no formato
 * "25 ago de 2026 às 11h"; cards "1º Leilão"/"2º Leilão" com R$ ao lado.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, titleCase, UF_POR_NOME, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  nordeste: { fonte: 'NORDESTE', leiloeiro: 'Nordeste Leilões', base: 'https://www.nordesteleiloes.com.br' },
};

// Nível 1: eventos na home renderizada.
export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/leiloes\/(\d+)-[a-z0-9-]+)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}

// Nível 2: lotes dentro do evento renderizado.
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/lotes\/(\d+-\d+)-[a-z0-9-]+)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lotes\/(\d+-\d+)/) || [])[1] || null;

const MES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
function datasPorExtenso(txt) {
  const ds = [];
  for (const m of String(txt).matchAll(/(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s+de\s+(20\d{2})/gi)) {
    const d = new Date(+m[3], MES[m[2].toLowerCase().slice(0, 3)], +m[1]);
    if (!isNaN(d)) ds.push(d);
  }
  return ds;
}

// Slug → cidade/UF/área. Estado vem POR EXTENSO no fim ("…-amargosa-bahia"); a cidade é o
// trecho entre a área (ou o tipo) e o estado. Sem estado no slug → deixa nulo (qualidade decide).
function doSlug(slug) {
  let s = String(slug || '').replace(/^\d+-\d+-/, '');
  let estado = null, resto = s;
  for (const [nome, uf] of Object.entries(UF_POR_NOME)) {
    if (s.endsWith(`-${nome}`)) { estado = uf; resto = s.slice(0, -(nome.length + 1)); break; }
  }
  let area = 0;
  const ma = resto.match(/com-([\d.,]+)-?(m2|metros|hectares?|ha)\b/i) || resto.match(/([\d.,]+)(m2|ha)\b/i);
  if (ma) {
    area = num(ma[1]);
    if (/hect|^ha$/i.test(ma[2])) area *= 10_000;
  }
  // Cidade: o que sobra depois do último marcador de área/tipo — melhor esforço: últimas 1-3
  // palavras do slug sem números.
  const palavras = resto.split('-').filter(w => w && !/\d/.test(w) && !/^(m2|ha|hectares?|com|de|do|da|em|urbano|rural|comercial|residencial|imovel|casa|apartamento|terreno|galpao|sala|lote)$/i.test(w));
  const cidade = palavras.length ? titleCase(palavras.slice(-3).join(' ')).slice(0, 60) : null;
  return { estado, area, cidade };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = (String(url).match(/\/lotes\/([a-z0-9-]+)/i) || [])[1] || '';

  // Cards "1º Leilão … R$ X" / "2º Leilão … R$ Y": 1º = avaliação, 2º = mínimo.
  const m1 = txt.match(/1[º°ª]\s*Leil[ãa]o[^R]{0,80}?R\$\s*([\d.]+,\d{2})/i);
  const m2 = txt.match(/2[º°ª]\s*Leil[ãa]o[^R]{0,80}?R\$\s*([\d.]+,\d{2})/i);
  const mAval = txt.match(/Avalia[çc][ãa]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/i);
  let avaliacao = plaus(num(mAval?.[1])) || plaus(num(m1?.[1]));
  let minimo = plaus(num(m2?.[1])) || plaus(num(m1?.[1])) || avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const { estado, area, cidade } = doSlug(slug);
  const datas = datasPorExtenso(txt).sort((a, b) => a - b);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fut = datas.find(d => d >= hoje) || datas[datas.length - 1] || null;
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo: tituloDeSlug(slug), cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade: 'judicial',   // acervo é 100% varas federais/TRT (recon 20-21/08)
    area_m2: area,
    descricao: null,
    data_leilao: fut ? fut.toISOString().slice(0, 10) : null,
    numero_matricula: mat, ...docs,
    encerrado: datas.length > 0 && !datas.some(d => d >= hoje),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
