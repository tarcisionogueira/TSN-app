/**
 * Parser puro — WR LEILÕES (wrleiloes.com.br; Wesley Silva Ramos, matriz em Boa Vista/RR, filiais Manaus/Macapá/Rio
 * Branco; TRT11, DETRAN/SMTRAN). Plataforma própria (PHP + jQuery, "web/js/functions.js"), server-rendered, sem
 * anti-bot → fetch direto, grátis. Recon 30/10:
 *
 *   • Não há catálogo por categoria. `/agenda-de-leiloes` lista os leilões ABERTOS com link
 *     (`/leilao/<id>/<slug>`); os "Em loteamento" (ALEAP, DETRAN-AM) ainda não têm link. `/leiloes` vem vazio sem JS.
 *   • Leilão: cabeçalho com data ("30/11/2026 às 10:00", também no <title>) e status (`status aberto|andamento|
 *     encerrado`), cards de 20 lotes por página (`?page=N`; a paginação é `data-page` por JS, sem link na página).
 *     Em 30/10: TRT11 "IMOVEIS e MOVEIS" (734, 25 lotes, 12 imóveis — o resto é móvel, barco, carro e moto) e SMTRAN
 *     (810, 114 veículos).
 *   • O card do imóvel vem como "DIVERSOS/" (ou "LOTE DE TERRAS - … /") com linha vazia; o de VEÍCULO como
 *     "MARCA/Modelo" + "COR, 2007/2007," — o filtro do card tira o veículo antes de abrir a página. "DIVERSOS" também
 *     é mesa, bebedouro, barco: quem decide é o "DADOS DO BEM:" do lote (`naoImovel`).
 *   • Lote `/lote/<id>/<slug>`: "Lance inicial: R$ …" (`#valorVencendo`; vira "Lance atual" com lance), descrição com
 *     processo CNJ, "DADOS DO BEM: …", "VALOR TOTAL DA AVALIAÇÃO: R$ …"; fotos `imgTmp/ft<hash>.png` (slide vazio
 *     `imgTmp/` = sem foto); edital `/download/<hash>.pdf`. A página do lote NÃO tem data — vem do leilão, que o parser
 *     busca uma vez por leilão (link "Leilão:" do próprio lote).
 *   • Cidade quase nunca vem "Cidade/UF": "desta cidade" + "Registro de Imóveis … de Manaus/AM", "município de
 *     Parintins, Estado do Amazonas", "Boa Vista-RR", "Rio Preto da Eva – AM". A UF por extenso vira sigla e o nome só
 *     vale se for município de verdade (cidadeDoTexto); sem nome nenhum, fica nula (não inventa Manaus).
 *   • ⚠️ Lote imóvel numa página 2+ de leilão cujo página 1 só tem veículo não é visto (o runner para no evento quando
 *     a página não traz lote novo). Em 30/10 não acontece: o 734 traz imóvel nas duas páginas e o 810 só tem veículo.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { tipoDaDescricao } from './parquedosleiloes-parse.mjs';

const BASE = 'https://www.wrleiloes.com.br';
export const TENANTS = {
  wrleiloes: { fonte: 'WRLEILOES', leiloeiro: 'WR Leilões (Wesley Silva Ramos)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

export const textoDe = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<br\s*\/?>|<\/p>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** `/agenda-de-leiloes` → Map id → url do leilão. Leilão só de trânsito (DETRAN/SMTRAN) fica de fora, salvo se o nome citar imóvel. */
export function extrairUrlsDeEvento(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/(?:www\.)?wrleiloes\.com\.br)?(\/leilao\/(\d+)\/([a-z0-9-]+))"/gi)) {
    if (/detran|smtran|transito|veiculo/i.test(m[3]) && !/imove/i.test(m[3])) continue;
    out.set(m[2], `${BASE}${m[1]}`);
  }
  return out;
}

/** Página do leilão → Map id → url do lote. Card de veículo ("MARCA/Modelo", "COR, 2007/2007,") sai aqui. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const card of String(html || '').split(/<div class="item">/i).slice(1)) {
    const link = card.match(/href="(\/lote\/(\d+)\/[^"]*)"/i);
    if (!link) continue;
    const h3 = textoDe((card.match(/<h3>([\s\S]*?)<\/h3>/i) || [])[1]);
    const p = textoDe((card.match(/<div class="infos">[\s\S]*?<p>([\s\S]*?)<\/p>/i) || [])[1]);
    const veiculo = /\/\s*\S/.test(h3) || /\b(?:19|20)\d{2}\s*\/\s*(?:(?:19|20)\d{2}|undefined)\b|\b(?:RECUPERAVEL|SUCATA)\b/i.test(`${h3} ${p}`);
    if (!veiculo) out.set(link[2], `${BASE}${link[1]}`);
  }
  return out;
}

const iso = (d, h) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; const t = String(h || '').match(/(\d{1,2}):(\d{2})/); return `${m[3]}-${m[2]}-${m[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00`; };
const FORA = /encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad/i;

/** Cabeçalho do leilão: nome, data, status. */
export function lerLeilao(html) {
  const h = String(html || '');
  const dataTxt = textoDe((h.match(/<div class="data">([\s\S]*?)<\/div>/i) || [])[1]) || (h.match(/data:\s*(\d{2}\/\d{2}\/\d{4}\s*às\s*\d{1,2}:\d{2})/i) || [])[1] || '';
  const d = dataTxt.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:às)?\s*(\d{1,2}:\d{2})?/);
  const status = h.match(/<span class="status\s+([a-z]+)"[^>]*>([\s\S]*?)<\/span>/i);
  return {
    nome: textoDe((h.match(/<div class="header-leilao">[\s\S]*?<h2>([\s\S]*?)<\/h2>/i) || [])[1]),
    data: d ? iso(d[1], d[2]) : null,
    status: status ? status[1].toLowerCase() : null,
    situacao: status ? textoDe(status[2]) : null,
  };
}

const UF_EXTENSO = { amazonas: 'AM', roraima: 'RR', acre: 'AC', 'amapá': 'AP', amapa: 'AP', 'pará': 'PA', para: 'PA', 'rondônia': 'RO', rondonia: 'RO', tocantins: 'TO', 'maranhão': 'MA', maranhao: 'MA' };
const RE_UF_EXTENSO = new RegExp(`,?\\s*(?:no\\s+)?Estado\\s+d[oe]\\s+(${Object.keys(UF_EXTENSO).join('|')})(?![A-Za-zÀ-ÿ])`, 'gi');

/** Cidade/UF do texto do bem, nas formas que este leiloeiro usa (ver cabeçalho). */
export function cidadeDoBem(texto) {
  const norm = String(texto || '')
    .replace(RE_UF_EXTENSO, (_, e) => `/${UF_EXTENSO[e.toLowerCase()]}`)
    .replace(/\s*[-–]\s*([A-Z]{2})\b/g, '/$1');
  const direto = cidadeDoTexto(norm);
  if (direto.cidade) return direto;
  // Nome sem UF ("Registro de Imóveis … de Manaus.", "nesta cidade de Parintins", "Município do Iranduba"): só vale se
  // for município de uma UF citada no texto (ou da região do leiloeiro).
  const ufs = [...new Set([...norm.matchAll(/\/([A-Z]{2})\b/g)].map((m) => m[1]).concat(['AM', 'RR', 'AP', 'AC']))];
  const re = /(?:munic[íi]pio|cidade|comarca|Registro\s+de\s+I\s?m[óo]veis[^.;]{0,60}?|Prefeitura\s+Municipal)\s+d[eoa]s?\s+([A-ZÀ-Ú][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][A-Za-zÀ-ÿ']+){0,3})/g;
  for (const m of norm.matchAll(re)) {
    for (const uf of ufs) { const c = cidadeDoTexto(`${m[1]}/${uf}`); if (c.cidade) return c; }
  }
  return { cidade: null, estado: null };
}

// Fronteira à mão: `\b` do JS não conhece letra acentuada — "Uma área de terras" (54351) não casava com `\b[áa]rea`.
const RE_IMOVEL = /(?<![A-Za-zÀ-ÿ])(im[óo]ve(?:l|is)|terrenos?|lotes?\s+de\s+terras?|[áa]reas?\s+de\s+terras?|apartamentos?|casas?|sobrados?|fazendas?|glebas?|ch[áa]caras?|s[íi]tios?|pr[ée]dios?|galp(?:[ãa]o|[õo]es)|salas?\s+comerciai?s?|lojas?|edif[íi]cios?)(?![A-Za-zÀ-ÿ])/i;

// Uma busca da página do leilão por execução (cache por fetchFonte: cada rodada do motor tem o seu).
const caches = new WeakMap();
async function leilaoDe(urlLeilao, fetchFonte) {
  if (!urlLeilao || !fetchFonte) return null;
  if (!caches.has(fetchFonte)) caches.set(fetchFonte, new Map());
  const cacheLeilao = caches.get(fetchFonte);
  if (!cacheLeilao.has(urlLeilao)) cacheLeilao.set(urlLeilao, fetchFonte(urlLeilao, { semBD: true }).then((r) => (r?.html ? { ...lerLeilao(r.html) } : { erro: r?.via || 'sem resposta' })));
  return cacheLeilao.get(urlLeilao);
}

export async function parseDetalhe(html, url, { fetchFonte = null, agora = new Date() } = {}) {
  const h = String(html || '');
  const desc = h.match(/<div class="description">([\s\S]*?)<\/div>/i);
  const lance = h.match(/<span class="title_lance">([^<]*)<\/span>[\s\S]{0,120}?id='valorVencendo'>([\d.,]+)</i);
  if (!desc || !lance) return null;
  const descricao = textoDe(desc[1]).replace(/^DIVERSOS\s+/i, '');
  const dados = (descricao.match(/DADOS DO BEM:?\s*(.*?)(?:\s+VALOR TOTAL DA AVALIA|$)/i) || [])[1] || descricao;
  const hrefLeilao = (h.match(/Leil[ãa]o:\s*<a href="([^"]+)"/i) || [])[1];
  const urlLeilao = hrefLeilao ? (hrefLeilao.startsWith('http') ? hrefLeilao : `${BASE}${hrefLeilao}`) : null;
  const leilao = await leilaoDe(urlLeilao, fetchFonte);
  // Sem a página do leilão não há data nem situação: "não consegui ler" (sem detalhe no runner), nunca lote sem data.
  if (!leilao || leilao.erro) {
    if (leilao?.erro) console.log(`   [WRLEILOES] lote ${idDaUrl(url)}: página do leilão não abriu (${leilao.erro})`);
    return null;
  }
  const nomeLeilao = leilao?.nome || textoDe((h.match(/Leil[ãa]o:\s*<a [^>]*>([\s\S]*?)<\/a>/i) || [])[1]);
  const local = cidadeDoBem(dados).cidade ? cidadeDoBem(dados) : cidadeDoBem(descricao);
  // "VALOR TOTAL DA AVALIAÇÃO: R$ 800.000,00", "AVALIAÇÕES: R$ …", "avaliado em sua totalidade no valor de R$ …".
  const aval = num((descricao.match(/VALOR TOTAL DA AVALIA[ÇC][ÃA]O:?\s*R\$\s*([\d.]+,\d{2})/i)
    || descricao.match(/AVALIA[ÇC](?:[ÃA]O|[ÕO]ES):?\s*R\$\s*([\d.]+,\d{2})/i)
    || descricao.match(/avaliad[oa]\s+em\s+sua\s+totalidade\s+no\s+valor\s+de\s+R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const fotos = [...new Set([...h.matchAll(/<div class="swiper-slide"><img[^>]*src="(https?:\/\/[^"]*\/imgTmp\/[^"]+\.(?:png|jpe?g|webp))"/gi)].map((m) => m[1]))];
  const edital = (h.match(/href="((?:https?:\/\/(?:www\.)?wrleiloes\.com\.br)?\/download\/[^"]+\.pdf)"/i) || [])[1];
  const linkEdital = edital ? (edital.startsWith('http') ? edital : `${BASE}${edital}`) : null;
  // Título: o que é + onde ("Apartamento - Rua Rio Madeira, nº 1122 - Manaus/AM").
  const tipo = tipoDaDescricao(dados);
  const onde = (dados.match(/(?:situad[oa]|localizad[oa])\s+(?:[àa]|na|no|em)\s+((?:Rua|Av(?:enida|\.)?|Estrada|Travessa|Rodovia|Alameda|Ramal|Beco)\b[^,;]*(?:,\s*n[º°o]?\s*[\d.]+)?)/i) || dados.match(/denominad[oa]\s+[“"]?([A-ZÀ-Ú][^,;”"]{2,40}?)[”"]?(?=[,;]|\s+de\s+Matr)/) || [])[1];
  const oQue = tipo || (/terras?\b/i.test(dados.slice(0, 80)) ? 'Terreno' : 'Imóvel');
  const base = `${oQue}${onde ? ` - ${titleCase(onde.toLowerCase())}` : ''}`;
  const titulo = (local.cidade ? `${base} - ${local.cidade}/${local.estado}` : base).slice(0, 200);
  const data = leilao?.data || null;
  const situacao = leilao?.situacao || null;
  return {
    titulo,
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval || 0, valor_minimo: num(lance[2]), valor_minimo_2: null,
    modalidade: /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(descricao) || /tribunal|\bvara\b|\btrt\d*\b|judicial/i.test(nomeLeilao) ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(dados) || 0,
    descricao: descricao.slice(0, 8000) || null,
    data_leilao: data, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: linkEdital || url,
    link_matricula: null,
    anexos: linkEdital ? [{ tipo: 'edital', nome: 'Edital', url: linkEdital }] : [],
    numero_matricula: numeroMatriculaDoTexto(dados) || numeroMatriculaDoTexto(descricao) || null,
    situacao,
    naoImovel: !RE_IMOVEL.test(dados.slice(0, 200)),
    encerrado: leilao?.status === 'encerrado' || FORA.test(`${situacao || ''} ${lance[1]}`) || (data ? Date.parse(data) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
