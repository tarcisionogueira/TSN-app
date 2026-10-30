/**
 * Parser puro — FLÁVIO GARCIA LEILÕES (flaviogarcia.lel.br, Porto Alegre/RS; Flávio Bittencourt Garcia — Justiça
 * Federal de POA e interior, Justiça Estadual da Grande POA e do Litoral). Fila #380. Plataforma PHP própria
 * (Bootstrap, `gerenciador/arquivos/…`, lances por `controllers/ajax_lances.php`), server-rendered, UTF-8, sem anti-bot.
 * Recon 30/10:
 *
 *   • Home lista os LEILÕES (eventos), não os lotes: `/leilao/<slug>/<id>` (206 Unificado, 207 Justiça Estadual,
 *     208/209 Venda Direta Justiça Federal). O evento lista os lotes: `/lote/<slug>/<id>` — imóvel, veículo e "bens em
 *     geral" juntos (veículo sai pelo slug `um-veiculo`, como no TRIACCA). 30/10: 11 lotes, 9 imóveis (4 vagas de
 *     garagem em Pelotas, que o filtro de negócio descarta; 5 terrenos/casas em Guaíba, Triunfo e Osório).
 *   • Lote: `<h1>` = nome do leilão; "1º Leilão: 14/04/2027 - 09:00" / "2º Leilão: …" em `<h3>`; o texto do edital diz
 *     "DAS 9 HORAS, ATÉ ÀS 14 HORAS" (o pregão FECHA às 14h — é o fim que vale para encerrado); título em `<strong>`
 *     depois do carrossel; "Avaliação: R$ 80.000,00". O "Lance Minimo" da página do lote vem VAZIO (preenchido por
 *     AJAX), assim como o selo "BEM ARREMATADO!" (escondido, ligado por JS).
 *   • Por isso o parser lê também a página do EVENTO (uma vez por evento, `fetchFonte`), que traz server-rendered o que
 *     falta: o selo do lote ("À VISTA" ou "SUSPENSO" — veículo 1904 em 30/10), o "Lance Minimo" (o da 2ª praça: 64.000
 *     = 80% de 80.000 no 1903, 322.000 = 70% no 1905, como o texto de cada lote diz) e a aba "Arquivos do leilão" com
 *     "EDITAL LOTE 2" / "MATRÍCULA 17.517 LOTE 2" / "EDITAL LOTE 3 E 4" → PDFs em `gerenciador/arquivos/leiloes/`.
 *     O lote não linka o evento pelo slug, só por `lista_arrematante/pdf.php?leilao_id=206`; o servidor ignora o slug
 *     (`/leilao/x/206` responde o mesmo evento), então a URL é montada com o slug do `<h1>`.
 *   • Valor da praça corrente: 1ª praça futura → avaliação ("1º LEILÃO: Lance mínimo: valor da avaliação"); 1ª passada →
 *     o mínimo do evento (2ª praça). VENDA DIRETA (208): as "praças" são o PERÍODO (03/09/2026 a 01/03/2027 14h) e o
 *     mínimo é o do evento (100% nos 30 primeiros dias, depois 50% — 6.500 em 30/10).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.flaviogarcia.lel.br';
export const TENANTS = {
  flaviogarcia: { fonte: 'FLAVIOGARCIA', leiloeiro: 'Flávio Garcia Leilões (Flávio Bittencourt Garcia)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/(\d+)/) || [])[1] || null;
const texto = (html) => decodificarEntidades(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SLUG_NAO_IMOVEL = /(^|-)(veiculo|automovel|caminhao|caminhonete|motocicleta|moto|onibus|trator|maquina|reboque|semirreboque)(-|$)/i;
const NAO_IMOVEL = /\b(ve[íi]culo|autom[óo]vel|caminh[ãa]o|motocicleta|placa\s+[A-Z]{3}|RENAVAM|m[áa]quina|trator)\b/i;
const FORA = /\b(suspens|arrematad|vendid|cancelad|encerrad|retirad|sustad|adiad)/i;

/** Home → Map id → url dos leilões (eventos). */
export function extrairUrlsDeEvento(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/(?:www\.)?flaviogarcia\.lel\.br)?(\/leilao\/[a-z0-9-]+\/(\d+))"/gi)) out.set(m[2], `${BASE}${m[1]}`);
  return out;
}
/** Evento → Map id → url dos lotes (o que o slug diz ser veículo/máquina não é lido). */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/(?:www\.)?flaviogarcia\.lel\.br)?(\/lote\/([a-z0-9-]+)\/(\d+))"/gi)) {
    if (SLUG_NAO_IMOVEL.test(m[2])) continue;
    out.set(m[3], `${BASE}${m[1]}`);
  }
  return out;
}

/** Página do evento → { lotes: Map id → { numero, selo, avaliacao, lanceMinimo }, arquivos: [{ nome, url }] }. */
export function lerEvento(html) {
  const h = String(html || '');
  const lotes = new Map();
  for (const tr of h.split(/<tr\b/i).slice(1)) {
    const id = (tr.match(/\/lote\/[a-z0-9-]+\/(\d+)"/i) || [])[1];
    const numero = (texto(tr).match(/Lote n[ºo°]\s*(\d+)/i) || [])[1];
    if (!id || !numero || lotes.has(id)) continue;
    const t = texto(tr);
    lotes.set(id, {
      numero: Number(numero),
      selo: texto((tr.match(/class="btn btn-sm[^"]*"[^>]*>([\s\S]*?)<\/a>/i) || [])[1]),
      avaliacao: num((t.match(/Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]),
      lanceMinimo: num((t.match(/Lance M[íi]nimo:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]),
    });
  }
  const arquivos = [];
  for (const m of h.matchAll(/<td>\s*([^<]{3,120}?)\s*<\/td>\s*<td>\s*<a href="([^"]+\.pdf)"/gi)) {
    arquivos.push({ nome: texto(m[1]), url: m[2].startsWith('http') ? m[2] : `${BASE}/${m[2].replace(/^\//, '')}` });
  }
  return { lotes, arquivos };
}
/** "EDITAL LOTE 3 E 4" / "MATRÍCULA 5.666 LOTE 3" → o arquivo é deste lote? */
// 208: "EDITAL LOTES 1,2,3 e 4 NO EDITAL APENAS AS DATAS MUDARAM…" — a lista pode vir no meio do nome.
const doLote = (nome, n) => {
  const m = String(nome).match(/LOTES?\s+(\d+(?:\s*(?:,|\be\b)\s*\d+)*)/i);
  return !!m && m[1].split(/\s*(?:,|\be\b)\s*/i).map(Number).includes(n);
};

const iso = (d, h) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; const t = String(h || '').match(/(\d{1,2}):(\d{2})/); return `${m[3]}-${m[2]}-${m[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00`; };

/** Lote + (opcional) evento já lido → det. Puro: o `parseDetalhe` abaixo só busca o evento e chama este. */
export function detalheDoLote(html, url, { agora = new Date(), evento = null } = {}) {
  const h = String(html || '');
  const id = idDaUrl(url) || (h.match(/id="lote_id"[^>]*value="(\d+)"/i) || [])[1];
  const nomeLeilao = texto((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const p1 = h.match(/1\s*º\s*Leil[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}:\d{2})/i);
  const p2 = h.match(/2\s*º\s*Leil[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}:\d{2})/i);
  // Título e descrição: o bloco depois do carrossel — `<strong>TÍTULO</strong>` seguido dos `<p>` do texto.
  const bloco = (h.match(/<div class="col-md-12">\s*<p>\s*([\s\S]*?)<\/p>\s*<\/div>\s*<div class="col-md-6">/i) || [])[1] || '';
  const titulo = texto((h.match(/<h3[^>]*>\s*<strong>([^<]{3,150})<\/strong>\s*<\/h3>\s*<\/div>\s*<div class="col-md-12">\s*<p>/i) || [])[1]);
  const desc = texto(bloco);
  const t = texto(h.slice(h.search(/<body/i)));
  const aval = num((t.match(/Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  if (!id || !nomeLeilao || (!p1 && !p2) || !desc) return null;
  // Fim do pregão de cada praça: "1º LEILÃO: 14/04/2027 DAS 9 HORAS, ATÉ ÀS 14 HORAS" (o h3 dá a ABERTURA).
  // O evento 207 não escreve o "ATÉ ÀS"; só "para cada lance recebido a partir das 13:57 horas, serão acrescidos 03
  // minutos" — o pregão fecha às 14h.
  const prorroga = (t.match(/a partir das\s*(\d{1,2}):5\d\s*horas/i) || [])[1];
  const ate = (n) => (t.match(new RegExp(`${n}\\s*º\\s*LEIL[ÃA]O:\\s*\\d{2}\\/\\d{2}\\/\\d{4}[^.]{0,40}?AT[ÉE]\\s*[ÀA]S\\s*(\\d{1,2})\\s*HORAS`, 'i')) || [])[1]
    || (prorroga ? String(Number(prorroga) + 1) : null);
  const d1 = p1 ? iso(p1[1], ate(1) ? `${ate(1)}:00` : p1[2]) : null;
  const d2 = p2 ? iso(p2[1], ate(2) ? `${ate(2)}:00` : p2[2]) : null;
  const vendaDireta = /venda direta/i.test(nomeLeilao);
  const ev = evento?.lotes?.get(String(id)) || null;
  const passou1 = d1 && Date.parse(d1) < agora;
  const fim = d2 || d1;
  // Preço da praça corrente (ver cabeçalho). Sem o evento, na 2ª praça/venda direta, cai na avaliação: é o teto, nunca
  // um número inventado abaixo dele.
  const minimo = (vendaDireta || passou1) ? (ev?.lanceMinimo || aval) : aval;
  const n = ev?.numero;
  const arqs = n ? (evento?.arquivos || []).filter((a) => doLote(a.nome, n)) : [];
  const edital = arqs.find((a) => /^EDITAL/i.test(a.nome))?.url || null;
  const matricula = arqs.find((a) => /^MATR[ÍI]CULA/i.test(a.nome))?.url || null;
  const fotos = [...new Set([...h.matchAll(/src="([^"]*gerenciador\/arquivos\/bens\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1].startsWith('http') ? m[1] : `${BASE}/${m[1].replace(/^\//, '')}`))];
  // "Gua&iacute;ba/RS", "Os&oacute;rio/RS"; "Comarca de Triunfo-RS" (hífen) também.
  const comBarra = (s) => String(s).replace(/([A-Za-zÀ-ÿ])\s*[-–]\s*(RS|SC|PR)\b/g, '$1/$2');
  const local = [cidadeDoTexto(desc), cidadeDoTexto(comBarra(desc))].find((c) => c.cidade) || { cidade: null, estado: null };
  // "UM IMÓVEL" (1905) não diz nada: vale a 1ª oração do texto ("Um terreno urbano situado na Praia de Atlântida Sul").
  const generico = !titulo || /^UMA?\s+(IM[ÓO]VEL|BEM)$/i.test(titulo);
  const frase = generico ? (desc.match(/^(.{10,110}?)(?:,|\.\s|$)/) || [])[1] : null;
  const tit = titleCase((frase || titulo || nomeLeilao).toLowerCase());
  const naoImovel = NAO_IMOVEL.test(`${titulo} ${desc.slice(0, 300)}`) && !/im[óo]vel|terreno|casa|apartamento|fra[çc][ãa]o de terra|box|vaga/i.test(titulo);
  return {
    titulo: (local.cidade && !tit.includes(local.cidade) ? `${tit} - ${local.cidade}/${local.estado}` : tit).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: minimo, valor_minimo_2: null,
    modalidade: vendaDireta ? 'venda_direta' : 'judicial',
    area_m2: extrairAreaM2(desc) || 0,
    descricao: [desc, `${nomeLeilao}.`].join(' ').slice(0, 8000),
    data_leilao: vendaDireta ? d2 || d1 : (passou1 && d2 ? d2 : d1 || d2),
    data_leilao_2: !vendaDireta && !passou1 && d1 && d2 && d2 !== d1 ? d2 : null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: matricula,
    anexos: [...(edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : []), ...(matricula ? [{ tipo: 'matricula', nome: 'Matrícula', url: matricula }] : [])],
    numero_matricula: numeroMatriculaDoTexto(desc) || desc.match(/Matriculad[oa] sob n[úu]mero\s*([\d.]{1,9})\b/i)?.[1] || null,
    situacao: ev?.selo || null,
    naoImovel,
    encerrado: FORA.test(ev?.selo || '') || (fim ? Date.parse(fim) < agora : false),
  };
}

// Evento lido uma vez por coleta (vários lotes por evento). Guarda a PROMESSA: lotes em sequência reaproveitam.
const eventos = new Map();
export async function parseDetalhe(html, url, { fetchFonte, agora = new Date() } = {}) {
  const h = String(html || '');
  const leilaoId = (h.match(/lista_arrematante\/pdf\.php\?leilao_id=(\d+)/i) || [])[1];
  const nomeLeilao = texto((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  let evento = null;
  if (leilaoId && fetchFonte) {
    const evUrl = `${BASE}/leilao/${slug(nomeLeilao) || 'leilao'}/${leilaoId}`;
    if (!eventos.has(evUrl)) eventos.set(evUrl, fetchFonte(evUrl, { semBD: true }).then((r) => {
      if (!r?.html) console.warn(`[flaviogarcia] evento ${leilaoId} não abriu (${r?.via || 'sem resposta'}) — lote sem selo/edital/mínimo da 2ª praça`);
      return r?.html ? lerEvento(r.html) : null;
    }));
    evento = await eventos.get(evUrl);
  }
  return detalheDoLote(h, url, { agora, evento });
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
