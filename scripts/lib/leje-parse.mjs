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
 * Cidade/UF vem do texto livre da descrição ("Rio de Janeiro/RJ"). Documentos: ver documentosLeje
 * (22/10) — estão no HTML, em listas escondidas, com link docs.php?doc=N.
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, textoComLinhas, titleCase, anexosDeHtml, montarRowDom, cidadeUFBare } from './dom-parse-util.mjs';

export const TENANTS = {
  leje: { fonte: 'LEJE', leiloeiro: 'LEJE — Leilão Judicial Eletrônico', base: 'https://leje.com.br' },
};

// ⚠️ 20/10 (#250) — A HOME MUDOU: desde ~12/10 ela lista EVENTOS (`acao=evento&cod=N`, SEM `lote=`) e o
// extrator, que só aceitava `lote=`, enumerava 0 com 43 eventos no ar (recon Firecrawl: home 200, 43 `cod=`
// distintos, 0 `lote=`). A página do evento de LOTE ÚNICO ("Lote Único") é a própria página do lote — não
// tem link `lote=` e não traz o id do lote em lugar nenhum do HTML. Por isso o fluxo virou de 2 níveis:
// home → evento (extrairUrlsDeEvento); no evento, os links `lote=` (vários lotes) ou o próprio evento como
// lote, com id `e<cod>` — prefixo para nunca colidir com os ids de lote antigos (~18–19 mil; cod ~6–8 mil).
export function extrairUrlsDeEvento(html, base) {
  const evs = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]*acao=evento(?:&|&amp;)cod=(\d+))["'#]/gi)) {
    if (/[?&](?:amp;)?lote=/.test(m[1])) continue;
    try { evs.set(m[2], new URL(`/index.php?acao=evento&cod=${m[2]}`, base).href); } catch { /* skip */ }
  }
  return evs;
}

// O evento aberto é ele mesmo um lote? Exige as DUAS provas: a linha "ID: <cod>" do bloco do lote (a mesma que
// parseDetalhe usa para saber que não caiu na home) e a âncora do próprio evento (`cod=<cod>#`) — a home tem os
// cartões "ID 7873", mas sem essa âncora; e evento com vários lotes tem links `lote=`, que vencem.
function loteUnicoDoEvento(html, base) {
  const h = String(html || '');
  if (/acao=evento[^"']*[?&](?:amp;)?lote=\d+/i.test(h)) return null;
  const linhaId = textoComLinhas(h).split('\n').map((l) => l.trim()).find((l) => /^ID:\s*\d+$/i.test(l));
  const cod = linhaId && linhaId.match(/(\d+)/)[1];
  if (!cod || !new RegExp(`acao=evento(?:&|&amp;)cod=${cod}#`).test(h)) return null;
  try { return { cod, url: new URL(`/index.php?acao=evento&cod=${cod}`, base).href }; } catch { return null; }
}

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  // O HTML cru vem com "&amp;" entre os parâmetros da query string — "&" sozinho (sem "amp;")
  // NUNCA precede "lote=" aqui, por isso o "amp;" opcional no meio do padrão.
  for (const m of String(html || '').matchAll(/href=["']([^"']*acao=evento[^"']*[?&](?:amp;)?lote=(\d+)[^"']*)["']/gi)) {
    try { urls.set(m[2], new URL(m[1].replace(/&amp;/g, '&'), base).href); } catch { /* skip */ }
  }
  if (!urls.size) { const u = loteUnicoDoEvento(html, base); if (u) urls.set(`e${u.cod}`, u.url); }
  return urls;
}

// Evento de lote único: o det sai da página que o nível 2 já abriu (o motor não paga o Firecrawl duas vezes).
export function detalhesDoCatalogo(html, base) {
  const out = new Map();
  const u = loteUnicoDoEvento(html, base);
  if (u) { const det = parseDetalhe(html, u.url); if (det) out.set(u.url, det); }
  return out;
}

export const idDaUrl = url => {
  let lote = null, cod = null;
  try { const q = new URL(url).searchParams; lote = q.get('lote'); cod = q.get('cod'); }
  catch { lote = (String(url).match(/[?&]lote=(\d+)/) || [])[1] || null; cod = (String(url).match(/[?&]cod=(\d+)/) || [])[1] || null; }
  return lote || (cod ? `e${cod}` : null);
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
  const cu = cidadeUFBare(txt);
  // 20/10: o título do LEJE é "... NO EDIFÍCIO ANTARES EM GUARUJÁ/SP" — a regex levava "Edifício Antares em
  // Guarujá". A cidade é o que vem depois do ÚLTIMO " em ".
  const cidade = cu.cidade && /\sem\s/i.test(cu.cidade) ? titleCase(cu.cidade.split(/\sem\s/i).pop()) : cu.cidade;
  const estado = cu.estado;
  const area = extrairArea(titulo || '', txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : 'judicial';
  const mat = (txt.match(/Matr[íi]cula\s*n[º°]?\s*:?\s*([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);
  const docsLeje = documentosLeje(html, url);
  if (docsLeje.length) {
    docs.anexos = [...docsLeje, ...(docs.anexos || []).filter(a => !docsLeje.some(d => d.url === a.url))];
    docs.link_edital = docsLeje.find(d => d.tipo === 'edital')?.url || docs.link_edital;
    docs.link_matricula = docsLeje.find(d => d.tipo === 'matricula')?.url || docs.link_matricula;
  }

  // FOTO (20/10): a genérica (fotoDeHtml, dentro de `docs`) pegava o LOGO DO TRIBUNAL (`tribunais/...png`) — a
  // galeria do lote é a dos `swiper-slide`; o resto da página são cartões de OUTROS leilões, que nunca podem
  // virar foto deste. Sem galeria, nenhuma foto: melhor vazio que a imagem errada.
  const galeria = [...new Set([...String(html || '').matchAll(/class=["']swiper-slide["'][^>]*>\s*<img[^>]+src=["']([^"']*\/storage\/public\/imagem\/[^"']+)["']/gi)]
    .map((m) => { try { return new URL(m[1], url).href; } catch { return null; } }).filter(Boolean))];
  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaDataLeje(bloco) || proximaData(bloco),
    numero_matricula: mat, ...docs, link_foto: galeria[0] || null, fotos: galeria,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 1500)),
  };
}

/**
 * DOCUMENTOS DO LOTE (22/10, #284). Não são carregados por AJAX, como este cabeçalho supunha: vêm no
 * próprio HTML, em listas escondidas `<div id="ab_anexos">` / `<div id="ab_edital">` (as abas só as
 * mostram). O link é `docs.php?doc=<n>` — SEM .pdf no endereço (o ".pdf" está só no nome), e por isso
 * o anexosDeHtml genérico, que exige .pdf no href, nunca os viu: 42 lotes ativos com 0 documento.
 * Conferido pelo Firecrawl no lote 18670: relação de imóveis e avaliações, termo de constrição,
 * certidão de valor venal, extrato de débitos municipais e MATRÍCULA 110.036.
 */
export function documentosLeje(html, urlBase) {
  const anexos = [];
  for (const bloco of ['ab_edital', 'ab_anexos']) {
    const m = String(html || '').match(new RegExp(`<div[^>]+id=["']${bloco}["'][^>]*>([\\s\\S]*?)</div>`, 'i'));
    if (!m) continue;
    for (const a of m[1].matchAll(/<a[^>]+href=["']([^"']*docs\.php\?doc=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let url; try { url = new URL(a[1].replace(/&amp;/g, '&'), urlBase).href; } catch { continue; }
      if (anexos.some(x => x.url === url)) continue;
      const nome = textoDe(a[2]).replace(/\.pdf$/i, '').trim().slice(0, 120) || 'Documento';
      const tipo = bloco === 'ab_edital' || /edital/i.test(nome) ? 'edital'
        : /matr[íi]cula/i.test(nome) ? 'matricula'
        : /laudo|avalia[çc]/i.test(nome) ? 'laudo' : 'outro';
      anexos.push({ tipo, nome, url });
    }
  }
  return anexos;
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
