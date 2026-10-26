/**
 * Parser puro — SUPORTE "CLÁSSICO" (Symfony + jQuery: `/build/runtime.*.js`, `var SL_API = "https://api.suporteleiloes.com"`,
 * catálogo `/categoria/<Tipo>`), o front que a nota de 26/10 chamava de "Aguarde…, bens montados por JS" e por isso
 * deixava de fora (simoesleiloes, vjleiloes). Medido pelo banco (pg_net) em 26/10: o "Aguarde…" é só o spinner do
 * topo — o servidor ENTREGA os cards no HTML (`<div id="lote<N>" class="lote">`) com título, descrição, "Localização:
 * CIDADE / UF", "Primeira praça: dd/mm/aaaa hh:mm", "Segunda praça: …", o lance inicial e o status. Não há página de
 * lote útil para ler (no Simões, `/lote/8/` dá 404 para os próprios cards da vitrine): o card É o dado
 * (`detalhesDoCatalogo` — o motor não abre detalhe).
 *
 * Tenants (leiloeiro_junta `nao_coletado`, mesma impressão digital — SL_API + /build + /categoria + /funcionamento):
 *  - Simões Leilões (MG): `/categoria/Imóveis` sem card; a vitrine só tem 8 "Veículos" de DEMONSTRAÇÃO da Suporte
 *    (foto em static.suporteleiloes.com/intranetsuporteleiloescom, título "Motocicleta 2", status "Rascunho").
 *  - VJ Leilões (MG): nenhum card em categoria nenhuma.
 *  - Marco Aurélio Leiloeiro (marcoleiloes, SC): 2 imóveis no card, ambos com praças de 2023 (encerrados).
 * Ligados assim mesmo (regra do dono, 26/10): o dia em que publicarem, o lote entra.
 */
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { inferirTipo, extrairArea } from './leilaopro-parse.mjs';
import { plaus, montarRowDom } from './dom-parse-util.mjs';
import { brl, dataBR, cidadeIbge, cidadeDoTexto, RE_FECHADO, checarQualidade } from './suporte-next-parse.mjs';

export const TENANTS = {
  simoes: { fonte: 'SIMOESLEILOES', leiloeiro: 'Simões Leilões (João Simões de Almeida Júnior)', base: 'https://www.simoesleiloes.com.br' },
  vj: { fonte: 'VJLEILOES', leiloeiro: 'VJ Leilões (Valter Jorge Fernandes)', base: 'https://www.vjleiloes.com.br' },
  marco: { fonte: 'MARCOLEILOES', leiloeiro: 'Marco Aurélio Leiloeiro', base: 'https://www.marcoleiloes.com.br' },
};

const semTags = (h) => decodificarEntidades(String(h || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/ /g, ' ').replace(/[ \t]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
const umaLinha = (h) => semTags(h).replace(/\s+/g, ' ').trim();

// Cards da vitrine. O fim de um card é o começo do próximo (o `div` da descrição traz HTML colado do editor, com
// `<div>` aninhado sem fechar direito — contar chaves de tag erraria).
export function cards(html) {
  const s = String(html || '').replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const ini = [...s.matchAll(/<div id="lote(\d+)" class="lote">/g)];
  return ini.map((m, i) => {
    const rodape = s.indexOf('</footer>', m.index);
    return { id: m[1], html: s.slice(m.index, i + 1 < ini.length ? ini[i + 1].index : rodape > 0 ? rodape : s.length) };
  });
}
const urlDoCard = (c, base) => { const m = c.html.match(/href="(\/lote\/\d+\/[^"#]*)"/); return m ? new URL(m[1], base).href : null; };

export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const c of cards(html)) { const u = urlDoCard(c, base); if (u) out.set(c.id, u); }
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;
// "Imóveis 2" no menu de tipos (`<div class="total">`): o total que o próprio site diz ter na categoria.
export function totalDaCategoria(html, nome = 'Im') {
  for (const m of String(html || '').matchAll(/<div class="content">\s*([^<]+?)\s*<\/div>\s*<div class="total">(\d+)<\/div>/g)) {
    if (new RegExp(`^${nome}`, 'i').test(m[1].trim())) return Number(m[2]);
  }
  return null;
}

export function detalheDoCard(c, url, { agora = new Date() } = {}) {
  const h = c.html;
  const titulo = umaLinha((h.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]);
  if (!titulo) return null;
  const descricao = semTags((h.match(/<p class="descricao">([\s\S]*?)<div class="(?:info-more|lote-stats)"/) || [])[1]).slice(0, 8000) || null;
  const loc = umaLinha((h.match(/Localiza[çc][ãa]o:\s*([\s\S]*?)<\/small>/) || [])[1]);
  const [cidLoc, ufLoc] = loc.split(/\s*\/\s*/);
  const uf = /^[A-Z]{2}$/.test(String(ufLoc || '').trim().toUpperCase()) ? ufLoc.trim().toUpperCase() : null;
  const doTexto = cidadeDoTexto(`${titulo} | ${descricao || ''}`, uf);
  const pracas = [...h.matchAll(/<strong>\s*(Primeira|Segunda|Terceira|[ÚU]nica)\s+pra[çc]a:\s*<\/strong>\s*([^<]+)/gi)]
    .map((m) => ({ iso: dataBR(m[2]), n: m[1] })).map((p) => ({ ...p, t: Date.parse(p.iso || '') })).filter((p) => Number.isFinite(p.t));
  const valor = plaus(brl((h.match(/<div class="stats valorAtual">\s*<span>([^<]*)<\/span>/) || [])[1]));
  const status = umaLinha((h.match(/<a class="lote-status[^"]*">([\s\S]*?)<\/a>/) || [])[1]);
  const foto = (h.match(/background-image:\s*url\(([^)]+)\)/) || [])[1]?.trim() || null;
  const iVig = pracas.findIndex((p) => p.t >= +agora);
  const vig = iVig >= 0 ? pracas[iVig] : null;
  const prox = iVig >= 0 ? pracas[iVig + 1] || null : null;
  const venda = /venda\s+direta/i.test(h);
  return {
    id: c.id, titulo: titulo.slice(0, 180), descricao, status,
    cidade: cidadeIbge(cidLoc, uf) || doTexto?.cidade || null, estado: uf || doTexto?.estado || null,
    valor_avaliacao: 0, valor_minimo: valor, valor_minimo_2: null,
    data_leilao: vig ? vig.iso.slice(0, 10) : null, data_leilao_2: prox ? new Date(prox.t).toISOString() : null,
    modalidade: venda ? 'venda_direta' : /judicial/i.test(h) && !/extrajudicial/i.test(h) ? 'judicial' : 'extrajudicial',
    tipo: inferirTipo(titulo, url), area_m2: extrairArea(titulo, descricao || ''),
    numero_matricula: (`${titulo} ${descricao || ''}`.match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d][\d.]{2,})/i) || [])[1]?.replace(/\.$/, '') || null,
    anexos: [], link_edital: null, link_matricula: null, link_foto: /^https?:\/\//.test(foto || '') && !/intranetsuporteleiloescom/.test(foto) ? foto : null,
    // "Rascunho" (o lote nem foi publicado), "Vendido", "Encerrado"…; ou todas as praças já passaram.
    encerrado: (status && RE_FECHADO.test(status)) || (pracas.length > 0 && !vig && !venda),
  };
}

export function detalhesDoCatalogo(html, base) {
  const out = new Map();
  for (const c of cards(html)) {
    const u = urlDoCard(c, base);
    const det = u && detalheDoCard(c, u);
    if (det) out.set(u, det);
  }
  return out;
}

// O motor só chama parseDetalhe quando o catálogo não trouxe o det — aqui, nunca (a página do lote não serve).
export const parseDetalhe = () => null;
export function montarRow(url, det, tenant) {
  const row = montarRowDom(url, det, tenant, det.id, inferirTipo);
  return { ...row, tipo: det.tipo || row.tipo, link_edital: url };
}
export { checarQualidade };
