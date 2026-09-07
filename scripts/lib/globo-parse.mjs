/**
 * Parser puro — GLOBOLEILOES (globoleiloes.com.br). Fonte `dom`, plataforma própria (recon
 * 07/09). Catálogo confirmado real na home (`<article>` com URL de lote já completa,
 * `/leiloes?category=X&subcategory=Y` como filtro). Detalhe confirmado real (lote 2623,
 * Guaratinguetá/SP):
 *   • "Lote 1 - SP - Guaratinguetá - Residencial Santa Bárbara | Terreno / Lote - 379m²"
 *   • "50% de desconto" (badge no topo — é o desconto da 2ª praça, não um rótulo solto de valor)
 *   • "Valor de avaliação atualizado: R$ 242.119,30 (agosto/2026)."
 *   • Regra do site, no corpo do edital: "...na 2ª Praça, aquele que oferecer lance igual ou
 *     superior a 50% do valor da avaliação atualizado" — CONFIRMA que o badge de desconto é a
 *     regra da 2ª praça, não um evento pontual deste lote. `valor_minimo` é CALCULADO a partir
 *     do desconto anunciado (não inventado: é a própria regra do leiloeiro aplicada ao próprio
 *     valor de avaliação do leiloeiro).
 *   • PDFs reais em CloudFront (nomes opacos, tipo por TEXTO da aba/link, não pela URL).
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, textoComLinhas, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  globo: { fonte: 'GLOBOLEILOES', leiloeiro: 'Globo Leilões', base: 'https://globoleiloes.com.br' },
};

let _dumpFeito = false; // DEBUG (07/09, temporário): ver comentário abaixo, enumerados=0

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/leiloes\/lote-\d+-[a-z0-9-]+\/(\d+))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  // DEBUG (07/09, temporário — remover após diagnosticar): 1ª rodada de dump confirmou HTML
  // real e completo (396KB, domínio certo, sem bloqueio) mas SEM NENHUMA ocorrência de
  // "/leiloes/lote-" no documento inteiro — o site mudou o padrão de URL desde o recon
  // original. Esta 2ª rodada varre TODOS os hrefs internos (relativos) pra achar o padrão
  // atual, em vez de continuar chutando uma palavra-chave por vez.
  if (!urls.size && !_dumpFeito) {
    _dumpFeito = true;
    const h = String(html || '');
    const hrefs = new Set();
    for (const m of h.matchAll(/href=["'](\/[^"'#][^"']{0,80})["']/gi)) hrefs.add(m[1]);
    const comLote = [...hrefs].filter((u) => /lote/i.test(u));
    console.log(`[DEBUG-GLOBO-HREFS] html.length=${h.length} · hrefs internos únicos=${hrefs.size} · com "lote" no path=${comLote.length}`);
    console.log(`[DEBUG-GLOBO-HREFS] amostra (30): ${JSON.stringify([...hrefs].slice(0, 30))}`);
    if (comLote.length) console.log(`[DEBUG-GLOBO-HREFS] com "lote": ${JSON.stringify(comLote.slice(0, 15))}`);
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/leiloes\/lote-\d+-[a-z0-9-]+\/(\d+)/i) || [])[1] || null;

function anexosGlobo(html, urlBase) {
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
  const linhas = textoComLinhas(html).split('\n');

  const avaliacao = plaus(num((txt.match(/Valor\s+de\s+avalia[çc][ãa]o\s+atualizado\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  // Desconto anunciado (badge "50% de desconto" OU a regra "X% do valor da avaliação" no
  // corpo) — regra do PRÓPRIO leiloeiro pra 2ª praça, não invenção do parser.
  const descPct = Number((txt.match(/(\d{1,3})\s*%\s*(?:de\s+desconto|do\s+valor\s+da\s+avalia)/i) || [])[1] || 0);
  const minimo = (avaliacao && descPct > 0 && descPct < 100) ? Math.round(avaliacao * (1 - descPct / 100) * 100) / 100 : avaliacao;

  const linhaLote = linhas.find((l) => /^Lote\s+\d+\s*-/i.test(l)) || '';
  const titulo = linhaLote ? linhaLote.replace(/\s*\|\s*/g, ' — ').slice(0, 180) : null;

  const cUf = txt.match(/\b([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+(?:\s[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+){0,2})\/([A-Z]{2})\b(?=[^]{0,60}Cart[óo]rio|[^]{0,10}$)/) || txt.match(/\b([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+(?:\s[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+){0,2})\/([A-Z]{2})\b/);
  const cidade = cUf ? cUf[1] : null;
  const estado = cUf ? cUf[2] : null;

  const area = extrairArea(titulo || '', txt.slice(0, 2000));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial|processo\s*n/i.test(txt) ? 'judicial' : 'judicial';
  const mat = (txt.match(/matr[íi]cula\s*:?\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosGlobo(html, url);

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
