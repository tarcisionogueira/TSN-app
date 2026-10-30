/**
 * Parser puro — PARQUE DOS LEILÕES (parquedosleiloes.com.br, Brasília/DF; família Braggio). Fila dos leiloeiros com
 * imóvel e sem leitor (#380). Plataforma BRClick (Laravel, server-rendered, sem anti-bot) — nenhum outro site da lista
 * das Juntas a usa (conferido em 30/10 sobre 180 homes). Recon 30/10:
 *
 *   • Duas listas separadas no site: `/leiloes` (extrajudiciais: BRB, bens, veículos) e `/leiloes-judiciais` (varas do
 *     TJDFT). As duas aceitam `type_id=3` (Imóveis) e `is_lot=1` (lista LOTES, 12 por página, mais novos primeiro) —
 *     dispensa o nível de evento e os leilões de equipamento de 300 lotes. Daí as DUAS fontes do mesmo leiloeiro (a
 *     varredura de sumidos é por fonte; uma fonte com dois catálogos se apagaria sozinha).
 *   • Lote `/leilao/<evento>/lote/<id>`: `<title>LOTE — EVENTO</title>` ("IMÓVEL EDEIA/GO — 3ª VARA … - 1ª PRAÇA") e
 *     `<div data-json="auctionLot">{id, started_at, ended_at, status_id, status_name, min_bid_value}</div>`. Depois:
 *     "Informações Título: … Descrição: …", documentos `/lote/<id>/documento/<n>` (PDF, ex.: LAUDO DE AVALIAÇÃO), edital
 *     `/leilao/<evento>/edital` (PDF) e fotos `/storage/properties/<n>/images/<hash>.webp`.
 *   • ⚠️ A página traz também "Próximos Lotes" — descrição e foto de OUTRO imóvel. Tudo é lido ANTES desse bloco.
 *   • Cada praça é um EVENTO próprio (1503 = 1ª praça 19/10, 1514 = 2ª praça 22/10, lotes de id diferente). A avaliação
 *     não aparece na página do lote: na 1ª praça o lance inicial é a avaliação; na 2ª fica desconhecida.
 *   • `status_name` envelhece (lote de 14/09 ainda "aberto para lances" em 30/10) — encerrado é `ended_at` no passado.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { textoDe } from './mvleiloes-parse.mjs';

const BASE = 'https://www.parquedosleiloes.com.br';
export const TENANTS = {
  parque: { fonte: 'PARQUEDOSLEILOES', leiloeiro: 'Parque dos Leilões', base: BASE, catalogo: '/leiloes?is_lot=1&type_id=3' },
  parque_jud: { fonte: 'PARQUEDOSLEILOES_JUD', leiloeiro: 'Parque dos Leilões', base: BASE, catalogo: '/leiloes-judiciais?searchMode=judicial&is_lot=1&type_id=3' },
};

const RE_LOTE = /href=["'](?:https:\/\/www\.parquedosleiloes\.com\.br)?(\/leilao\/(\d+)\/lote\/(\d+))["']/gi;
export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

/** Lista (`is_lot=1`) → Map id do lote → url. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) out.set(m[3], `${BASE}${m[1]}`);
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

// "2026-11-23 15:20:00" (horário de Brasília, sem fuso) → ISO com -03:00.
const isoBrasilia = (s) => { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/); return m ? `${m[1]}T${m[2]}:${m[3] || '00'}-03:00` : null; };

export function loteJson(html) {
  const bruto = (String(html || '').match(/data-json="auctionLot">\s*(\{[\s\S]*?\})\s*</) || [])[1];
  if (!bruto) return null;
  try { return JSON.parse(decodificarEntidades(bruto)); } catch (e) { console.warn(`[parquedosleiloes] auctionLot ilegível: ${String(e?.message || e).slice(0, 80)}`); return null; }
}

// Ordem importa: "sala … do Residencial" é sala; "lote de terras" só vira terreno se nada antes casou.
const TIPOS = [
  [/\bapartamento|\bapto\b/i, 'Apartamento'], [/\bsala\b/i, 'Sala comercial'], [/\bloja\b/i, 'Loja'],
  [/\bsobrado\b/i, 'Sobrado'], [/\bcasa\b/i, 'Casa'], [/\bgalp[ãa]o\b/i, 'Galpão'], [/\bpr[ée]dio\b/i, 'Prédio'],
  [/\bfazenda\b|\bch[áa]cara\b|\bs[íi]tio\b|im[óo]vel rural/i, 'Imóvel rural'], [/\bterreno\b|lote de terras?\b|\blote\s+(?:n[º°o.]|urbano)/i, 'Terreno'],
];
export const tipoDaDescricao = (t) => (TIPOS.find(([re]) => re.test(String(t || ''))) || [])[1] || null;

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const lj = loteJson(h);
  if (!lj?.ended_at) return null;
  // Só o lote desta página: "Próximos Lotes" traz descrição e foto de outro imóvel.
  const corte = h.search(/<h3[^>]*>\s*Pr[óo]ximos Lotes/i);
  const proprio = corte > 0 ? h.slice(0, corte) : h;
  const [tituloLote = '', tituloEvento = ''] = textoDe((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).split(/\s+—\s+/);
  const corpo = textoDe(proprio.slice(proprio.search(/<body/i)));
  const descricao = (corpo.match(/Informa[çc][õo]es\s+T[íi]tulo:.*?Descri[çc][ãa]o:\s*(.*?)\s*(?:Documentos\b|$)/i) || [])[1] || '';
  // Categoria do lote, logo após o JSON ("Imóveis Online 1ª Praça").
  const categoria = (textoDe(proprio.slice(proprio.indexOf('data-json="auctionLot"'))).match(/\}\s*(\S[^]*?)\s+(?:Online|Presencial)\b/) || [])[1] || '';
  const segundaPraca = /\b2\s*[ªa]\s*PRA[ÇC]A\b/i.test(tituloEvento);
  const fim = isoBrasilia(lj.ended_at);
  const lance = Number(lj.min_bid_value) || 0;
  const local = [cidadeDoTexto(descricao), cidadeDoTexto(tituloLote)].find((c) => c.cidade) || { cidade: null, estado: null };
  const fotos = [...new Set([...proprio.matchAll(/https:\/\/www\.parquedosleiloes\.com\.br\/storage\/properties\/\d+\/images\/[a-f0-9]+\.(?:webp|jpe?g|png)/gi)].map((m) => m[0]))];
  const docs = [...proprio.matchAll(/href="(https:\/\/www\.parquedosleiloes\.com\.br\/lote\/\d+\/documento\/\d+)"[\s\S]{0,300}?<label>([^<]+)<\/label>/gi)]
    .map((m) => ({ tipo: /matr[íi]cula/i.test(m[2]) ? 'matricula' : /laudo|avalia/i.test(m[2]) ? 'laudo' : 'documento', nome: textoDe(m[2]), url: m[1] }));
  const edital = (proprio.match(/href="(https:\/\/www\.parquedosleiloes\.com\.br\/leilao\/\d+\/edital)"/i) || [])[1] || null;
  // Título genérico do site ("IMÓVEL PORTO ALEGRE/RS") não diz o que é; o tipo vem da descrição ("a sala 604…").
  const tipoDesc = tipoDaDescricao(descricao);
  const titulo = (/^IM[ÓO]VEL\b/i.test(tituloLote) && tipoDesc && local.cidade
    ? `${tipoDesc} em ${local.cidade}/${local.estado}`
    : titleCase(tituloLote.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`));
  return {
    titulo: titulo.slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: segundaPraca ? 0 : lance, valor_minimo: lance, valor_minimo_2: null,
    modalidade: /\bVARA\b|\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/i.test(`${tituloEvento} ${descricao}`) ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${descricao} ${tituloLote}`) || 0,
    descricao: [descricao, tituloEvento && `Leilão: ${tituloEvento}.`].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: fim, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: docs.find((d) => d.tipo === 'matricula')?.url || null,
    anexos: [...(edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : []), ...docs],
    numero_matricula: numeroMatriculaDoTexto(descricao) || null,
    naoImovel: !!categoria && !/im[óo]ve/i.test(categoria),
    encerrado: fim ? Date.parse(fim) < agora : false,
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
