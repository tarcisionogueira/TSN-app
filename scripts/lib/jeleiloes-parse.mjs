/**
 * Parser puro — JELEILOES (jeleiloes.com.br). Fonte `dom`: server-rendered, mas o motor de
 * fetch já é Puppeteer no runner (mesmo custo zero do ALFA/HASTA).
 *
 * ORIGEM (07/09): candidato achado por cruzamento de edital do DJEN (14 editais, 13 já
 * promovidos sem foto/doc — a maior taxa de promoção do lote de 13 candidatos). Recon real
 * via GitHub Actions (sem acesso de rede direto neste ambiente):
 *   • Backend é a MESMA infra do SUEDPETER/LIDER/VALERO etc. — `stats.suporteleiloes.com.br
 *     /ping` respondeu `clientId:"jeleiloes.com.br"` e a foto/PDF do lote vêm de
 *     `static.suporteleiloes.com.br/jeleiloescombr/...`. MAS o catálogo NÃO é o
 *     `/buscador?categoria=2` do template antigo (esse dá 404 aqui) — é `/imoveis?page=N`,
 *     um front-end mais novo da mesma plataforma. Por isso este é um parser PRÓPRIO, não uma
 *     entrada em `SUPORTE_TENANTS` (scraper-puppeteer.mjs) — o HTML/seletores não batem.
 *   • Detalhe do lote NÃO é rótulo solto tipo "Valor da Avaliação: R$ X" (ALFA) — é uma
 *     TABELA (Lote | Tipo do Bem | Valor de Avaliação | Lance Inicial - 2ª Praça/Hasta |
 *     Valor Débito | Lance Atual | Número de Lances | Status | Número de visitas), então
 *     `valorPorRotulo` (janela de 40 chars) não alcança o valor — os cabeçalhos das OUTRAS
 *     colunas ficam no meio. `linhaTabelaLote` lê a `<table>` de verdade; se a plataforma não
 *     renderizar como `<table>` num tenant futuro, cai para uma janela larga (400 chars) como
 *     rede de segurança.
 *   • URL do lote tem DUAS formas observadas: `/oferta/leilao/imoveis/<cat>/<id>/id-<id2>/
 *     <slug>` e `/ofertas/leilao/imoveis/<cat>/<id>/<id2>/<slug>` (plural, sem "id-").
 *   • Edital/matrícula são PDF de nome opaco (`sl-bem-<n>-hash.pdf`) — não dá pra classificar
 *     pela URL como o `anexosDeHtml` genérico faz; o rótulo mora no TEXTO do link ("VISUALIZAR
 *     EDITAL"/"VISUALIZAR MATRÍCULA"), daí `anexosJE` local em vez do helper compartilhado.
 */
import { inferirTipo, cidadeUF, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, cidadeUFDeSlug, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  jeleiloes: { fonte: 'JELEILOES', leiloeiro: 'JE Leilões', base: 'https://jeleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[a-z0-9-]+)\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\//i) || [])[1] || null;

const slugDa = url => (String(url).match(/\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?\d+\/([a-z0-9-]+)/i) || [])[1] || '';

// Tabela real (Lote | Tipo do Bem | Valor de Avaliação | Lance Inicial - 2ª Praça/Hasta | …).
// Lê <tr>/<td|th> de verdade — não innerText — porque o motor `dom` entrega `page.content()`.
// Pega a 1ª linha de DADOS após o cabeçalho (mesmo critério "1ª ocorrência = lote aberto" já
// usado no `valorPorRotulo`: se o leilão tiver mais de um lote na mesma tabela, o resto fica
// para uma iteração futura — melhor 1 lote certo que N lotes com valor trocado).
function linhaTabelaLote(html) {
  const linhas = [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      td[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()));
  const iCab = linhas.findIndex((cols) => cols.some((c) => /Valor\s+de\s+Avalia[çc][ãa]o/i.test(c))
    && cols.some((c) => /Lance\s+Inicial/i.test(c)));
  if (iCab < 0) return null;
  const cab = linhas[iCab];
  const iAval = cab.findIndex((c) => /Valor\s+de\s+Avalia[çc][ãa]o/i.test(c));
  const iLance = cab.findIndex((c) => /Lance\s+Inicial/i.test(c));
  for (let i = iCab + 1; i < linhas.length; i++) {
    const cols = linhas[i];
    if (cols.length < cab.length - 2) continue;   // não é linha de dado da mesma tabela
    if (!cols.some((c) => /R\$/.test(c))) continue;
    return { avaliacao: plaus(num(cols[iAval] || '')), minimo: plaus(num(cols[iLance] || '')) };
  }
  return null;
}

// Rede de segurança se a plataforma não renderizar `<table>` (tenant futuro da mesma família):
// janela BEM mais larga que o `valorPorRotulo` padrão (40 chars), pois aqui o rótulo do valor
// vem depois dos OUTROS cabeçalhos de coluna.
function valorJanela(txt, rotuloRe, janela = 400) {
  const re = new RegExp(`${rotuloRe.source}[^]{0,${janela}}?R\\$\\s*([\\d.]+,\\d{2})`, rotuloRe.flags.includes('i') ? 'i' : '');
  const m = txt.match(re);
  return m ? plaus(num(m[1])) : 0;
}

function descricaoDe(txt) {
  const m = txt.match(/DESCRI[ÇC][ÃA]O DO LOTE\s*([\s\S]{0,1500}?)(?:LOCAL PARA VISITA[ÇC][ÃA]O|OBSERVA[ÇC][ÃA]O|$)/i);
  return m ? m[1].trim().slice(0, 1500) || null : null;
}

// Foto real do bem (static.suporteleiloes.com.br/.../bens/...) — não o ícone/logo do template
// (/build/images/...) que também aparece nas <img> da página.
function fotoDe(html) {
  const imgs = [...String(html || '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  return imgs.find((u) => /static\.suporteleiloes\.com\.br/i.test(u) && /\/bens\//i.test(u)) || null;
}

// Edital/matrícula são PDF de nome opaco — a classificação mora no TEXTO do link ("VISUALIZAR
// EDITAL"/"VISUALIZAR MATRÍCULA"), não na URL (diferente do `anexosDeHtml` genérico).
function anexosJE(html, urlBase) {
  const anexos = []; let link_edital = null, link_matricula = null;
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    let abs; try { abs = new URL(m[1], urlBase).href; } catch { continue; }
    if (anexos.some((a) => a.url === abs)) continue;
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tipo = /matr[íi]cula/i.test(texto) ? 'matricula' : /edital/i.test(texto) ? 'edital' : 'outro';
    anexos.push({ tipo, nome: tipo === 'edital' ? 'Edital' : tipo === 'matricula' ? 'Matrícula / Laudo do bem' : 'Documento', url: abs });
    if (tipo === 'edital' && !link_edital) link_edital = abs;
    if (tipo === 'matricula' && !link_matricula) link_matricula = abs;
  }
  return { anexos, link_edital, link_matricula };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = slugDa(url);

  const tab = linhaTabelaLote(html);
  let avaliacao = tab?.avaliacao || 0;
  let minimo = tab?.minimo || 0;
  if (!avaliacao && !minimo) {
    avaliacao = valorJanela(txt, /Valor\s+de\s+Avalia[çc][ãa]o/i);
    minimo = valorJanela(txt, /Lance\s+Inicial/i);
  }
  if (!minimo) minimo = avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const titulo = tituloDeSlug(slug);
  let { cidade, estado } = cidadeUFDeSlug(slug);
  if (!cidade) {
    const doTexto = cidadeUF('', txt.slice(0, 3000));
    cidade = doTexto.cidade || null;
    estado = estado || doTexto.estado || null;
  }

  const descricao = descricaoDe(txt);
  const area = extrairArea(titulo || '', descricao || '');
  // "CLASSIFICAÇÃO Judicial - On-line" no cabeçalho do leilão; "AUTOS Nº" confirma processo.
  const modalidade = (/classifica[çc][ãa]o[^]{0,20}judicial/i.test(txt) || /autos\s*n[º°.]?\s*:?\s*[\d.\-/]+/i.test(txt))
    ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosJE(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao,
    data_leilao: proximaData(txt.slice(0, 4000)),
    numero_matricula: mat, ...docs,
    link_foto: fotoDe(html),
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2500)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
