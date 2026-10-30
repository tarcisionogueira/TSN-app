/**
 * Parser puro — JORGE BRASIL LEILOEIRO (jorgebrasil.lel.br, Porto Alegre/RS; Eng. Jorge Sidirlei de Godoy Brasil,
 * varas cíveis de Porto Alegre, Canoas e São Leopoldo — execuções de condomínio). Fila #380. Site estático feito à mão
 * ("Site por Douglas Fork", HTML 4 em tabela), UTF-8, sem anti-bot, sem plataforma de lances: o pregão é por Zoom.
 * Recon 30/10:
 *
 *   • NÃO HÁ PÁGINA DE LOTE. A home é a agenda inteira ("AGENDA DE LEILÕES - 2026"): uma `<tr>` por imóvel, com
 *     `<td height="45"><p>NOME DO CONDOMÍNIO</p></td>` · descrição + `<a href="2026/<x>.pdf">EDITAL</a>` + links FOTO
 *     (`2026/<x>.jpeg`) · "1º Leilão: 03/11<br>Lance mínimo: R$…" e "2º Leilão: 10/11<br>Lance mínimo: R$…".
 *     O detalhe sai do próprio catálogo (`detalhesDoCatalogo`, como o CAMPOLINA); a URL do lote é a home + `?item=<id>`
 *     (não `?lote=`: o inferirTipo lê a URL, e "lote" fazia sala comercial virar terreno), id = nome do PDF do edital (estável enquanto o leilão está na agenda; matrícula falta em 5 de 15).
 *     Por isso a triagem não achou "link de lote": o lote é uma linha de tabela.
 *   • 15 imóveis em 30/10 (praças 03/11–10/11 e 11/12–18/12). Data SEM ANO ("03/11"; uma vez "18/12/26"): o ano sai
 *     do "Atualizado em 27/10/2026" da própria página — data mais de 60 dias antes da atualização é do ano seguinte
 *     (agenda de dezembro listando janeiro). Ancorado na página, não no relógio: leilão passado que fica na agenda
 *     continua no ano dele.
 *   • A página não dá HORA. Os 7 editais lidos em 30/10 (Guadalupe, Dom Alonso, Tancredo, Leopoldina, Paineiras,
 *     Plaza Miró, Akinita) marcam "às 11:00 horas" nas duas praças — vale 11:00.
 *   • Cidade: metade das linhas diz ("Canoas/RS", "Porto Alegre/RS"), parte abrevia ("R.I. da 5ª Z de P.A.", "Poa/RS")
 *     e parte não diz nada (Dom Alonso, Tancredo Neves, Colina das Paineiras, Plaza Miró) — os editais dessas quatro
 *     são todos de Porto Alegre, e o site é "Leilões de Imóveis em Porto Alegre". Leopoldina só diz "SÃO LEOPOLDO" no
 *     nome da linha. Ordem: cidade/UF do texto → P.A./Poa/Porto Alegre → nome da linha → Porto Alegre.
 *   • Todos judiciais (editais: "bem penhorado … Vara Cível"). Spartacus: avaliado R$ 440 mil, 1º lance R$ 420 mil —
 *     o lance vem da coluna de praças, a avaliação do texto.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { tipoDaDescricao } from './parquedosleiloes-parse.mjs';

const BASE = 'https://www.jorgebrasil.lel.br';
export const TENANTS = {
  jorgebrasil: { fonte: 'JORGEBRASIL', leiloeiro: 'Jorge Brasil Leiloeiro (Jorge Sidirlei de Godoy Brasil)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/[?&]item=([a-z0-9-]+)/i) || [])[1] || null;
const texto = (html) => decodificarEntidades(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const slug = (s) => String(s || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const HORA = '11:00';
const FORA = /\b(encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad)/i;

/** Linhas da agenda → [{ nome, corpoHtml, pracasHtml }]. Cada linha começa no `<td height="45">` do nome. */
export function linhasDaAgenda(html) {
  const h = String(html || '');
  const partes = h.split(/<td\s+height="45"[^>]*>/i).slice(1);
  return partes.map((p) => {
    const fimLinha = p.search(/<\/tr>/i);
    const linha = fimLinha >= 0 ? p.slice(0, fimLinha) : p;
    const nome = texto((linha.match(/^([\s\S]*?)<\/td>/i) || [])[1]);
    // A coluna de praças é a `<td>` com "1º Leilão"; o que vem antes é a descrição (a linha do Alto da Baviera 303
    // não fecha o `</td>` da descrição — por isso o corte é pelo texto, não pela tag).
    const iPraca = linha.search(/<td[^>]*>\s*<p>\s*1\s*[ºo°]\s*Leil/i);
    const corpoHtml = (iPraca >= 0 ? linha.slice(0, iPraca) : linha).replace(/^[\s\S]*?<\/td>/i, '');
    return { nome, corpoHtml, pracasHtml: iPraca >= 0 ? linha.slice(iPraca) : '' };
  }).filter((l) => l.pracasHtml);
}

/** "Atualizado em 27/10/2026" → Date de referência para o ano das praças. */
function referencia(html, agora) {
  const m = String(html || '').match(/Atualizado em\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00-03:00`);
  const ano = (String(html || '').match(/AGENDA DE LEIL(?:&Otilde;|Õ|O)ES\s*-\s*(\d{4})/i) || [])[1];
  return ano ? new Date(`${ano}-07-01T12:00:00-03:00`) : agora;
}
function dataPraca(dm, ref) {
  const m = String(dm || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const d = m[1].padStart(2, '0'), mes = m[2].padStart(2, '0');
  let ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ref.getFullYear();
  const iso = (a) => `${a}-${mes}-${d}T${HORA}:00-03:00`;
  if (!m[3] && Date.parse(iso(ano)) < ref.getTime() - 60 * 864e5) ano += 1;
  return iso(ano);
}

// Corte do título na 1ª cláusula de detalhe. Não corta em ". " — "Cond. Ed. Guadalupe", "Bl. C", "Av. Protásio".
const CORTE_TITULO = /,\s*(?:c\/|com\b|localizad|no\s+(?:\d|Bl\b|primeiro|segundo|terceiro|quarto|quinto|sexto|t[ée]rreo)|na cidade|de fundos|de frente|sendo|possuindo|tudo|que tomou|integrante|entrada)|\s+medindo\b|\.?\s+Quarteir/i;

export function detalheDaLinha({ nome, corpoHtml, pracasHtml }, { ref, agora = new Date() } = {}) {
  const desc = texto(corpoHtml.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')).replace(/\s*_\s*$/, '').trim();
  if (!desc) return null;
  const pr = texto(pracasHtml);
  const p1 = pr.match(/1\s*[ºo°]\s*Leil[ãa]o:\s*([\d/]+)\s*Lance m[íi]nimo:\s*R\$\s*([\d.]+,\d{2})/i);
  const p2 = pr.match(/2\s*[ºo°]\s*Leil[ãa]o:\s*([\d/]+)\s*Lance m[íi]nimo:\s*R\$\s*([\d.]+,\d{2})/i);
  if (!p1 && !p2) return null;
  const d1 = p1 ? dataPraca(p1[1], ref) : null, d2 = p2 ? dataPraca(p2[1], ref) : null;
  const v1 = p1 ? num(p1[2]) : 0, v2 = p2 ? num(p2[2]) : 0;
  const passou1 = d1 && Date.parse(d1) < agora;
  const fim = d2 || d1;
  const aval = num((desc.match(/(?:Avalia[çc][ãa]o|avaliad[oa][^R]{0,30}?por)\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]) || v1;
  const pdf = (corpoHtml.match(/href="([^"]+\.pdf)"/i) || [])[1];
  const abs = (p) => encodeURI(`${BASE}/${decodeURI(p).replace(/^\.?\//, '')}`);
  const edital = pdf ? abs(pdf) : null;
  const fotos = [...new Set([...corpoHtml.matchAll(/href="([^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => abs(m[1])))];
  const local = [
    cidadeDoTexto(desc),
    /\bP\.\s?A\.|\bPoa\b|Porto Alegre/i.test(desc) ? { cidade: 'Porto Alegre', estado: 'RS' } : null,
    cidadeDoTexto(`${nome}/RS`),
  ].find((c) => c?.cidade) || { cidade: 'Porto Alegre', estado: 'RS' };
  const frase = desc.split(CORTE_TITULO)[0].replace(/[:;,.\s]+$/, '').slice(0, 140);
  const tituloBase = titleCase(frase.toLowerCase()).replace(/\/([a-z]{2})\b/gi, (_, uf) => `/${uf.toUpperCase()}`)
    .replace(/\bM²/g, 'm²').replace(/\bPoa\/RS\b/g, 'Porto Alegre/RS');
  // "CONJUNTO 2109, do Edifício Galeria do Rosário": em Porto Alegre, conjunto = sala comercial; o léxico não conhece.
  const tipoDesc = inferirTipo(tituloBase, '') === 'outros' ? (/^conjunto\s+\d/i.test(frase) ? 'Sala comercial' : tipoDaDescricao(desc)) : null;
  const comTipo = `${tipoDesc ? `${tipoDesc} - ` : ''}${tituloBase}`;
  return {
    id: slug((pdf || '').split('/').pop()) || slug(nome),
    titulo: (comTipo.includes(local.cidade) ? comTipo : `${comTipo} - ${local.cidade}/${local.estado}`).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval,
    // Praça corrente: a 1ª enquanto não passou; depois, a 2ª.
    valor_minimo: passou1 && v2 ? v2 : (v1 || v2),
    valor_minimo_2: !passou1 && v2 ? v2 : null,
    modalidade: 'judicial',
    area_m2: extrairAreaM2(desc) || 0,
    descricao: `${titleCase(nome.toLowerCase())}. ${desc}`.slice(0, 8000),
    data_leilao: passou1 && d2 ? d2 : (d1 || d2),
    data_leilao_2: !passou1 && d1 && d2 && d2 !== d1 ? d2 : null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || BASE,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    numero_matricula: numeroMatriculaDoTexto(desc) || desc.match(/matr[íi]cula\s+(?:n[º°o.]*\s*)?([\d.]{1,9})\b/i)?.[1] || null,
    naoImovel: false,
    encerrado: FORA.test(`${nome} ${pr}`) || (fim ? Date.parse(fim) < agora : false),
  };
}

const urlDe = (id) => `${BASE}/?item=${id}`;

/** Home → Map url → det (o detalhe mora na própria agenda). */
export function detalhesDoCatalogo(html, _base, { agora = new Date() } = {}) {
  const ref = referencia(html, agora);
  const out = new Map();
  for (const l of linhasDaAgenda(html)) {
    const det = detalheDaLinha(l, { ref, agora });
    if (det?.id && !out.has(urlDe(det.id))) out.set(urlDe(det.id), det);
  }
  return out;
}
/** Home → Map id → url. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const [u, det] of detalhesDoCatalogo(html)) out.set(det.id, u);
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }
// Só chamado se o catálogo não trouxe o lote (não deveria acontecer): não existe página de lote para ler.
export const parseDetalhe = () => null;

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
