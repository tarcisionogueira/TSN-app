/**
 * Parser puro — MV LEILÕES (mvleiloes.com.br; Maicon Rodrigues Itaboray, JUCERJA — e Valéria Kahn). Fila dos 58
 * leiloeiros com imóvel e sem leitor (29/10, pendência #380). WordPress + Elementor, server-rendered, sem anti-bot.
 * O tipo de post `leilao_imoveis` NÃO está na REST (/wp-json/wp/v2/leilao_imoveis = rest_no_route) — lê-se o HTML.
 * Recon 29/10:
 *
 *   • home `/`: links `/leilao_imoveis/<slug>/` (23 únicos; abertos e encerrados juntos — 15 já tinham passado).
 *   • lote: `<title>Título – Maicon & Valéria Kahn – …`, id estável no `?p=<post>` (shortlink) / `postid-<post>`.
 *     Sem marcação semântica (Elementor): lê-se o TEXTO entre os rótulos. Topo: "1ª DATA dd/mm/aaaa hh:mm Lance
 *     inicial R$ X" e "2ª DATA … Lance inicial R$ Y" — nos ENCERRADOS as datas vêm vazias ("Leilão 1ª Praça") e só o
 *     edital as traz ("no dia 04/05/2026 das 14:00 horas … o 2º leilão ocorrerá no dia 05/05/2026"). Depois:
 *     "Endereço" → "O Imóvel" (descrição, com a avaliação "AVALIO … em R$ X") → "FOTOS" → "Edital" (texto inteiro).
 *     PDF do edital em `wp-content/uploads/AAAA/MM/*.pdf` (botão "BAIXAR EDITAL"); fotos no mesmo diretório, com as
 *     variantes redimensionadas `-LxA.jpeg` (descartadas).
 *   • O endereço quase nunca traz a cidade ("Apto 402, Rua Edgard Werneck, 710, Freguesia, Jacarepaguá"); a
 *     descrição ou o edital trazem ("Rio de Janeiro/RJ", "Comarca da Capital – RJ", "Gramado/RS").
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

export const TENANTS = {
  mv: { fonte: 'MVLEILOES', leiloeiro: 'MV Leilões (Maicon Rodrigues Itaboray)', base: 'https://mvleiloes.com.br' },
};

const RE_LOTE = /href=["'](https:\/\/mvleiloes\.com\.br\/leilao_imoveis\/([a-z0-9%-]+)\/?)["']/gi;
// O slug também identifica, mas o post id não muda se o leiloeiro reescrever o título.
export const idDaUrl = (url) => (String(url).match(/\/leilao_imoveis\/([a-z0-9%-]+)/i) || [])[1] || null;

/** Home → Map slug → url do lote. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) out.set(m[2], m[1].replace(/\/?$/, '/'));
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

/** HTML → texto em uma linha, sem script/style, entidades decodificadas. */
export function textoDe(html) {
  return decodificarEntidades(String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const dataISO = (d, h) => {
  const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null;
  const hh = (String(h || '').match(/(\d{1,2})[:h](\d{2})/) || []);
  return `${m[3]}-${m[2]}-${m[1]}T${hh[1] ? hh[1].padStart(2, '0') : '00'}:${hh[2] || '00'}:00-03:00`;
};

/** Praças: topo ("Nª DATA dd/mm/aaaa hh:mm Lance inicial R$ X") ou, sem ele, o edital. */
export function pracas(texto) {
  const topo = [...texto.matchAll(/([12])\s*ª\s*DATA\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}[:h]\d{2})?[^R]{0,40}?Lance inicial\s*R\$\s*([\d.]+,\d{2})/gi)];
  const lances = [...texto.matchAll(/Lance inicial\s*R\$\s*([\d.]+,\d{2})/gi)].map((m) => num(m[1]));
  const p = { 1: null, 2: null };
  for (const m of topo) p[m[1]] = { data: dataISO(m[2], m[3]), valor: num(m[4]) };
  if (!p[1]) {
    // Edital: "no dia 04/05/2026 das 14:00 horas" (1º) e "o 2º leilão ocorrerá no dia 05/05/2026".
    const ed = texto.slice(Math.max(0, texto.search(/\bEdital\b\s+JU[ÍI]ZO|EDITAL DE/i)));
    const d1 = ed.match(/(?:no|nos)\s+dias?\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(?:das|às|a partir das)\s+(\d{1,2}[:h]\d{2}))?/i);
    const d2 = ed.match(/2\s*[ºo°]\s*leil[ãa]o[^.]{0,60}?(?:dia|em)\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(?:das|às)\s+(\d{1,2}[:h]\d{2}))?/i);
    if (d1) p[1] = { data: dataISO(d1[1], d1[2]), valor: lances[0] || 0 };
    if (d2) p[2] = { data: dataISO(d2[1], d2[2] || d1?.[2]), valor: lances[1] || 0 };
  }
  return p;
}

const entre = (t, de, ate) => { const i = t.search(de); if (i < 0) return ''; const r = t.slice(i).replace(de, ''); const j = r.search(ate); return (j < 0 ? r.slice(0, 3000) : r.slice(0, j)).trim(); };

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const tituloBruto = textoDe((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).split(/\s+[–-]\s+Maicon/i)[0].trim();
  if (!tituloBruto) return null;
  const corpo = textoDe(h.slice(h.search(/<body/i)));
  const endereco = entre(corpo, /\bEndere[çc]o\b/, /\bO Im[óo]vel\b/);
  const descricao = entre(corpo, /\bO Im[óo]vel\b/, /\bFOTOS\b|Condi[çc][õo]es de pagamento/);
  const edital = entre(corpo, /\bEdital\s+(?=JU[ÍI]ZO|EDITAL|PODER|TRIBUNAL)/i, /Compartilh|Leil[õo]es Quem somos|©/);
  const { 1: p1, 2: p2 } = pracas(corpo);
  if (!p1?.data) return null; // sem data nenhuma não dá para saber se está aberto (ex.: terreno de Gramado em 29/10)
  const textoTodo = `${tituloBruto} ${endereco} ${descricao} ${edital}`;
  const aval = num((textoTodo.match(/(?:AVALIO[^R$]{0,80}|avaliad[oa][^R$]{0,60}|Avalia[çc][ãa]o[^R$]{0,40})R\$\s*([\d.]+,\d{2})/i) || [])[1]) || p1.valor || 0;
  let d1 = p1.data, v1 = p1.valor || aval, d2 = p2?.data || null, v2 = p2?.valor || 0;
  // Entre as praças: vale a 2ª (lance de agora).
  if (d2 && Date.parse(d1) < agora && Date.parse(d2) >= agora) { d1 = d2; v1 = v2 || v1; d2 = null; v2 = 0; }
  const fim = d2 || d1;
  // Ordem: endereço e descrição (falam do bem) → cartório/comarca da Capital do RJ → só então o resto do edital, que cita
  // a cidade das PARTES (29/10: Pechincha saía "Niterói" por "empresa … com sede em Niterói/RJ").
  const capitalRJ = /(?:Registro de Im[óo]veis|Comarca)\s+da\s+Capital\s*(?:\/|[–-])?\s*(?:do\s+)?RJ|Comarca da Capital\b[^.]{0,40}\bRJ\b/i.test(textoTodo);
  const local = [cidadeDoTexto(endereco), cidadeDoTexto(descricao)].find((c) => c.cidade)
    || (capitalRJ ? { cidade: 'Rio de Janeiro', estado: 'RJ' } : null)
    || [cidadeDoTexto(edital)].find((c) => c.cidade)
    || { cidade: null, estado: null };
  const pdf = (h.match(/href="(https:\/\/mvleiloes\.com\.br\/wp-content\/uploads\/[^"]+\.pdf)"/i) || [])[1] || null;
  const fotos = [...new Set([...h.matchAll(/https:\/\/mvleiloes\.com\.br\/wp-content\/uploads\/20\d\d\/\d\d\/[^"' )]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]))]
    .filter((u) => !/logo|cropped|-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp)$/i.test(u));
  const judicial = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|JU[ÍI]ZO DE DIREITO|VARA C[ÍI]VEL|art\.?\s*88\d\s+do\s+CPC/i.test(edital || descricao);
  const titulo = titleCase(tituloBruto.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`);
  return {
    titulo: (local.cidade && !titulo.includes(local.cidade) ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: v1, valor_minimo_2: v2 && v2 !== v1 ? v2 : null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${descricao} ${tituloBruto}`) || 0,
    descricao: [endereco && `Endereço: ${endereco}.`, descricao].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: pdf || url,
    link_matricula: null,
    anexos: pdf ? [{ tipo: 'edital', nome: 'Edital', url: pdf }] : [],
    // Só do bem: o edital traz também a matrícula do LEILOEIRO na Junta ("Maicon Rodrigues Itaboray, matrícula 0149").
    numero_matricula: numeroMatriculaDoTexto(descricao)
      || corpo.match(/matriculad[oa]\s+sob\s+(?:o\s+)?n[º°o.]*\s*(\d{1,3}(?:\.\d{3})+|\d{3,7})/i)?.[1] || null,
    naoImovel: false,
    encerrado: fim ? Date.parse(fim) < agora : false,
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
