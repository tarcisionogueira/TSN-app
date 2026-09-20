/**
 * Parser puro — família "Suporte Leilões", 3º TEMPLATE (leilaobrasil.com.br / lutheroleiloes.com.br).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * NÃO é o mesmo template do JELEILOES/KLEILOES (`/imoveis?page=N`, tabela de rótulos —
 * ver jeleiloes-parse.mjs) nem o `/buscador?categoria=2` do SUEDPETER/LIDER (SUPORTE_TENANTS
 * em scraper-puppeteer.mjs). É um 3º front-end da MESMA infra (confirmado 19/09 por
 * `static.suporteleiloes.com.br` no CDN de fotos/documentos e `arrematante.<dominio>/#/cadastro`
 * — subdomínio idêntico nos dois tenants).
 *
 * ⚠️ HISTÓRIA — 3ª INVESTIGAÇÃO DESTE SITE, E AS 2 ANTERIORES MEDIRAM A COISA ERRADA (forma
 * nº10 do CLAUDE.md). 20/08: chamado de "Cloudflare" achando que precisava de Bright Data pra
 * passar um desafio. 19/09 (mais cedo): testado contra `/buscador?categoria=2` — a rota do
 * template ERRADO (SUEDPETER/LIDER) — devolveu 0 `article.lote-main` e foi registrado como
 * "DESCARTADO, confirmado de novo". **Nenhuma das duas vezes o site foi realmente bloqueado**:
 * plain `fetch()` do GitHub Actions (sem proxy, sem Bright Data) devolve 200 com HTML completo
 * em toda rota testada nesta 3ª investigação (5 rodadas de recon, mesmo dia) — a home, os
 * lotes de detalhe, tudo server-rendered, sem Cloudflare, sem challenge.
 *
 * ESTRUTURA REAL (recon 19/09):
 *   • CATÁLOGO: a HOME (`/`) lista TODOS os anúncios ativos direto — confirmado ~230 links
 *     únicos `/eventos/leilao/<id-evento>/<slug>/lote` num fetch só. Não há sitemap.xml,
 *     `/eventos`, `/leiloes`, `/imoveis`, `/busca` (todos 404) — a HOME É o catálogo.
 *   • Cada link de listagem REDIRECIONA (fetch com redirect:'follow' resolve sozinho) pro
 *     lote de detalhe real: `/eventos/leilao/<slug-do-imovel>/lote/<id-lote>/<slug-do-imovel>`.
 *     Ex.: `/eventos/leilao/4408/predio-.../lote` → `/eventos/leilao/predio-.../lote/23842/predio-...`.
 *   • JSON EMBUTIDO — o achado que torna este parser robusto (não é regex sobre texto solto):
 *     a página do lote tem `<script>var lote = {...};</script>` com um objeto JSON completo
 *     (json_encode do backend, cru — não escapado como string, então dá pra isolar o `<script>`
 *     que contém "valorAvaliacao" e fazer JSON.parse direto). Estrutura (lote 24171, golden
 *     record do recon):
 *       lote.{id, descricao, valorAvaliacao, valorInicial, valorInicial2, valorMinimo,
 *             dataFechamento{date,...}, numero, status}
 *       lote.bem.{descricao, siteTitulo, siteDescricao(HTML com "Matrícula nº X" embutido),
 *                 endereco, numero, bairro, cidade, uf, cep, tipo{id,codigo,nome},
 *                 comitente{pessoa{name}}, image{full{url},thumb{url}}, arquivos[{url,...}],
 *                 areaEdificada, areaTerreno, processoNumero, processoVara, processoComarca}
 *       lote.leilao.{id, slug, codigo, titulo, judicial(bool!), praca, documentos[{url,...}],
 *                    leiloeiro{nome,uf,matricula}, dataProximoLeilao{date}, dataFimPraca1/2{date},
 *                    _urls{auditorio, edital}}
 *   • Sem __NEXT_DATA__, sem ld+json — só este `var lote`.
 *   • Fallback (site muda o formato / `var lote` some): rótulos em HTML cru já confirmados —
 *     `<strong>Cidade - UF</strong>...<span>Endereço</span>`, "Matrícula nº X" na descrição,
 *     "Tipo" + `<p>Judicial</p>`, EDITAL como PDF/DOCX em `static.suporteleiloes.com.br`.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';

export const TENANTS = {
  leilaobrasil: { fonte: 'LEILAOBRASIL', leiloeiro: 'Leilão Brasil', base: 'https://www.leilaobrasil.com.br' },
  luthero: { fonte: 'LUTHERO', leiloeiro: 'Luthero Leilões', base: 'https://lutheroleiloes.com.br' },
};

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;

// A HOME lista os anúncios direto — link de listagem que REDIRECIONA pro lote de detalhe.
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/eventos\/leilao\/(\d+)\/[^"']+\/lote)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}

// A URL FINAL (pós-redirect) tem o id do LOTE: /eventos/leilao/<slug>/lote/<ID>/<slug>.
// Se por algum motivo a URL ainda for a de listagem (redirect não resolveu), cai pro id do evento.
export function idDaUrl(url) {
  const s = String(url);
  return (s.match(/\/lote\/(\d+)(?:\/|$)/) || [])[1]
    || (s.match(/\/eventos\/leilao\/(\d+)\//) || [])[1]
    || null;
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// Isola o <script> com "var lote = {...};" e faz JSON.parse — NUNCA lança; null é o sinal de
// "não achei" pra quem chama cair no fallback de regex sobre HTML cru.
export function extrairJsonLote(html) {
  const h = String(html || '');
  for (const m of h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!m[1].includes('valorAvaliacao')) continue;
    const mv = m[1].match(/var\s+lote\s*=\s*(\{[\s\S]*\});/);
    if (!mv) continue;
    try { return JSON.parse(mv[1]); } catch { return null; }
  }
  return null;
}

const dataDe = obj => (obj && obj.date) ? obj.date.slice(0, 10) : null;

const MAPA_TIPO = {
  apartamento: 'apartamento', apartamentos: 'apartamento',
  casa: 'casa', casas: 'casa', sobrado: 'casa',
  terreno: 'terreno', terrenos: 'terreno', lote: 'terreno',
  comercial: 'comercial', sala: 'comercial', loja: 'comercial', galpao: 'comercial', predio: 'comercial', predios: 'comercial',
  rural: 'rural', fazenda: 'rural', sitio: 'rural', chacara: 'rural',
};
const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Fallback de rótulo em HTML cru (site mudou / var lote sumiu) — padrões confirmados no recon.
function parseDetalheFallback(html, url) {
  const txt = stripHtml(html);
  const mCidUf = html.match(/<strong>([^<]{2,60})\s*-\s*([A-Z]{2})<\/strong>\s*(?:<[^>]+>\s*)*<span>([^<]{3,150})<\/span>/i);
  const cidade = mCidUf ? mCidUf[1].trim() : null;
  const estado = mCidUf ? mCidUf[2].toUpperCase() : null;
  const endereco = mCidUf ? mCidUf[3].trim() : null;
  const titulo = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]?.trim() || null;
  const matricula = (txt.match(/Matr[íi]cula\s*n[ºo°]?\s*([\d.\-]+)/i) || [])[1] || null;
  const avaliacao = plaus(num((txt.match(/Avalia[çc][ãa]o\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]?.replace(/\./g, '').replace(',', '.')));
  const mEdital = html.match(/href=["']([^"']*static\.suporteleiloes\.com\.br[^"']*\.(?:pdf|docx)[^"']*)["']/i);
  const tipoTxt = (txt.match(/Tipo\s*[:\n]?\s*([A-Za-zà-ú]+)/i) || [])[1] || '';
  const judicial = /\bJudicial\b/i.test(txt) && !/Extrajudicial/i.test(txt.slice(0, (txt.search(/\bJudicial\b/i)) + 20));
  return {
    titulo, cidade, estado, endereco,
    valor_avaliacao: avaliacao, valor_minimo: avaliacao,
    area_m2: extrairArea(txt) || 0,
    // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica).
    descricao: txt.slice(0, 8000) || null,
    numero_matricula: matricula,
    link_edital: mEdital ? mEdital[1] : null,
    link_foto: null,
    data_leilao: null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    tipo_hint: tipoTxt,
    leiloeiro_nome: null,
  };
}

export function parseDetalhe(html, url) {
  const lote = extrairJsonLote(html);
  if (!lote || !lote.bem) return parseDetalheFallback(html, url);

  const bem = lote.bem || {};
  const leilao = lote.leilao || {};
  const descTexto = stripHtml(bem.siteDescricao || bem.descricao || '');
  const matricula = (descTexto.match(/Matr[íi]cula\s*n[ºo°]?\s*([\d.\-]+)/i) || [])[1] || null;
  const titulo = bem.siteTitulo || bem.descricao || leilao.titulo || null;
  const endereco = [bem.endereco, bem.numero].filter(Boolean).join(', ') || null;
  const avaliacao = plaus(num(lote.valorAvaliacao ?? bem.valorAvaliacao));
  const minimo = plaus(num(lote.valorMinimo ?? bem.valorMinimo)) || avaliacao;
  const linkEdital = leilao?._urls?.edital
    || (Array.isArray(leilao.documentos) ? leilao.documentos[0]?.url : null)
    || (Array.isArray(bem.arquivos) ? bem.arquivos[0]?.url : null)
    || null;
  const linkFoto = bem?.image?.full?.url || bem?.image?.thumb?.url || null;
  const dataLeilao = dataDe(leilao.dataProximoLeilao) || dataDe(leilao.dataFimPraca2) || dataDe(leilao.dataFimPraca1) || dataDe(lote.dataFechamento);
  const modalidade = leilao.judicial === true ? 'judicial' : (leilao.judicial === false ? 'extrajudicial' : 'judicial');

  return {
    titulo, cidade: bem.cidade || null, estado: bem.uf || null, endereco,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    area_m2: num(bem.areaEdificada) || num(bem.areaTerreno) || extrairArea(descTexto) || 0,
    // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica) — descTexto é o
    // texto real de bem.siteDescricao, sem limite útil de trazer inteiro (coluna `text`).
    descricao: descTexto.slice(0, 8000) || null,
    numero_matricula: matricula,
    link_edital: linkEdital, link_foto: linkFoto,
    data_leilao: dataLeilao,
    modalidade,
    tipo_hint: bem?.tipo?.nome || bem?.tipo?.codigo || '',
    leiloeiro_nome: leilao?.leiloeiro?.nome || null,
  };
}

export function montarRow(url, det, tenant) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const tipoChave = semAcento(det.tipo_hint).replace(/s$/, '');
  const tipo = MAPA_TIPO[semAcento(det.tipo_hint)] || MAPA_TIPO[tipoChave] || inferirTipo(det.titulo || '', url);
  const id = idDaUrl(url);
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo, modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao || null,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula || null, link_matricula: null,
    anexos: [],
    leiloeiro: det.leiloeiro_nome || tenant.leiloeiro,
    data_leilao: det.data_leilao || null, data_leilao_2: null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

export { checarQualidade };
