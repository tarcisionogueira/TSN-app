/**
 * Parser puro — NAKAKOGUELEILOES (nakakogueleiloes.com.br, Curitiba/PR). Plataforma Multiplix
 * (PHP, HTML estático, sem Cloudflare). Recon 05/10 (pendência #41):
 *
 *  - `/lotes/consulta/1` = categoria IMÓVEIS de todos os leilões abertos numa página só (a paginação
 *    é jPages, no navegador — o HTML traz tudo). `/lotes/consulta/2` = veículos.
 *  - Cada card já traz título-descrição (endereço, área, matrícula), categoria, "Valor Avaliado",
 *    "Valor Minimo", link do EDITAL (PDF) e "Situação" — por isso `detalhesDoCatalogo`: a página
 *    `detalhe-lote/<leilão>/<lote>` se preenche por JS via sessão PHP (`proximo_lote.php`, sem
 *    parâmetro), frágil como fonte e sem nada que o card já não tenha (salvo fotos).
 *  - A DATA e o NOME do leilão moram na home (`href="lotes/<leilão>"` … "Data: dd/mm/aaaa às hh:mm")
 *    — lidos uma vez por execução em `enriquecer` (lib/motor/fontes/nakakogue.mjs).
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, montarRowDom } from './dom-parse-util.mjs';
import { cidadeDoLote } from './albertomacedo-parse.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  nakakogue: { fonte: 'NAKAKOGUELEILOES', leiloeiro: 'Nakakogue Leilões', base: 'https://www.nakakogueleiloes.com.br' },
};

const RE_LOTE = /href=["']\/?(detalhe-lote\/(\d+)\/(\d+))["']/gi;
const limpo = (h) => decodificarEntidades(textoDe(h)).replace(/\s+/g, ' ').trim();

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) {
    try { urls.set(`${m[2]}_${m[3]}`, new URL(m[1], `${base}/`).href); } catch { /* href malformado: ignora o card */ }
  }
  return urls;
}
export const idDaUrl = (url) => { const m = String(url).match(/detalhe-lote\/(\d+)\/(\d+)/); return m ? `${m[1]}_${m[2]}` : null; };
export const leilaoDaUrl = (url) => (String(url).match(/detalhe-lote\/(\d+)\//) || [])[1] || null;

const rotulo = (bloco, re) => { const m = bloco.match(re); return m ? limpo(m[1]) : ''; };

// Um card = um <li> da lista `itemContainer`. Devolve Map url→det (gancho do runner).
export function detalhesDoCatalogo(html, base) {
  const out = new Map();
  const corpo = String(html || '');
  const ini = corpo.indexOf('itemContainer');
  for (const bloco of (ini >= 0 ? corpo.slice(ini) : corpo).split(/<li[\s>]/i).slice(1)) {
    const link = bloco.match(/href=["']\/?(detalhe-lote\/\d+\/\d+)["']/i);
    if (!link) continue;
    let url; try { url = new URL(link[1], `${base}/`).href; } catch { continue; }
    const tituloHtml = (bloco.match(/class=["']titulo-lote["'][^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || '';
    const texto = limpo(tituloHtml).replace(/^\d{1,6}\s*-\s*/, '');            // "001 - Item 1, …" → "Item 1, …"
    const categoria = rotulo(bloco, /Categoria:\s*<\/small>([^<]*)</i);
    const avaliado = plaus(num(rotulo(bloco, /Valor\s+Avaliado:\s*<\/small>([^<]*)</i)));
    const minimo = plaus(num(rotulo(bloco, /Valor\s+M[ií]nimo:\s*<\/small>([^<]*)</i)));
    const situacao = rotulo(bloco, /Situa(?:&ccedil;|ç)(?:&atilde;|ã)o:\s*<\/small>([^<]*)</i);
    const editalHref = (bloco.match(/Edital:\s*<\/small>\s*<a[^>]+href=["']([^"']+\.pdf)["']/i) || [])[1];
    let linkEdital = null; try { linkEdital = editalHref ? new URL(editalHref, `${base}/`).href : null; } catch { linkEdital = null; }
    const { cidade, estado } = cidadeDoLote(texto, '');
    const mat = (texto.match(/matr[íi]cula\s*(?:n[º°.o]?\s*)?([\d.]{3,})/i) || [])[1] || null;
    out.set(url, {
      categoria,
      titulo: texto.length > 140 ? `${texto.slice(0, 137).replace(/\s+\S*$/, '').replace(/[\s,;.-]+$/, '')}…` : texto,
      descricao: texto,
      cidade, estado,
      valor_avaliacao: avaliado || minimo, valor_minimo: minimo || avaliado,
      // Itaipu escreve a unidade ANTES do número ("Terreno (m2) 588,12, Casa (m2) 119,41"): vale o terreno.
      area_m2: extrairArea(texto, texto) || num((texto.match(/Terreno\s*\(m[²2]\)\s*([\d.]+,\d+|\d+)/i) || [])[1]) || 0,
      // Modalidade provisória pelo card; `enriquecer` corrige pelo NOME do leilão (home).
      modalidade: /aliena[cç][aã]o\s+fiduci/i.test(texto) ? 'extrajudicial' : 'judicial',
      numero_matricula: mat ? mat.replace(/\./g, '') : null,
      link_edital: linkEdital,
      anexos: linkEdital ? [{ tipo: 'edital', nome: 'Edital', url: linkEdital }] : [],
      data_leilao: null,
      // Card fora de "À Venda" (vendido, suspenso, retirado…) não entra. Categoria: só sai o que é
      // NOMEADAMENTE outra coisa — exigir "Imóveis" por extenso é frágil a acento estragado.
      encerrado: (situacao && !/venda/i.test(situacao)) || /ve[íi]cul|materia|sucata|semovent|m[áa]quina/i.test(categoria),
    });
  }
  return out;
}

// Home: cada leilão é um `href="lotes/<id>"` com title=<nome>, seguido de "Data: dd/mm/aaaa às hh:mm".
export function leiloesDaHome(html) {
  const out = new Map();
  const corpo = String(html || '');
  const marcas = [...corpo.matchAll(/href=["']\/?lotes\/(\d+)["']([^>]*)>/gi)]
    .map((m) => Object.assign(m, { 2: (m[2].match(/title=["']([^"']*)["']/i) || [])[1] || '' }));
  for (let i = 0; i < marcas.length; i++) {
    const id = marcas[i][1];
    if (out.has(id) && out.get(id).data) continue;
    const fim = marcas.slice(i + 1).find((m) => m[1] !== id)?.index ?? corpo.length;
    const trecho = limpo(corpo.slice(marcas[i].index, fim));
    const d = trecho.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    const nome = decodificarEntidades(marcas[i][2] || '').trim() || (out.get(id)?.nome ?? '');
    out.set(id, { nome, data: d ? `${d[3]}-${d[2]}-${d[1]}` : (out.get(id)?.data ?? null) });
  }
  return out;
}

export function modalidadeDoLeilao(nome, atual) {
  if (/aliena[cç][aã]o\s+fiduci|extrajudicial|venda\s+direta|binacional|\bALN\b/i.test(nome || '')) return 'extrajudicial';
  if (/massa\s+falida|fal[êe]ncia|recupera[cç][aã]o\s+judicial|vara|processo|execu[cç][aã]o|judicial/i.test(nome || '')) return 'judicial';
  return atual;
}

// O runner exige parseDetalhe; aqui só é usado se um card sumir do catálogo entre a enumeração e a
// coleta — sem dado no HTML do detalhe, devolve vazio (descartado por falta de valor, nunca inventado).
export function parseDetalhe() {
  return { titulo: null, cidade: null, estado: null, valor_avaliacao: 0, valor_minimo: 0, modalidade: 'judicial', encerrado: false };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
