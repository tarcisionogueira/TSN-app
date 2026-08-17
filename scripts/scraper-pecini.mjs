/**
 * Scraper PECINI Leilões — imóveis via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * O site barra o Puppeteer com Cloudflare (403), então usamos o Web Unlocker
 * (api/_brightdata.js — já com TETO SEMANAL de custo como fail-safe). Fluxo
 * recon-first (ver scripts/recon-novos-leiloeiros.mjs):
 *   1) GET /sitemap.xml  → enumera TODOS os lotes em 1 request (sem JS).
 *      É um feed de listings (home_listing): id + cidade + região por lote.
 *      A URL do lote segue o padrão /lote/{cidade-uf-slug}/{home_listing_id}/.
 *   2) Para cada lote (limitado a PECINI_MAX_LOTES/run p/ caber na cota grátis),
 *      GET da página de detalhe → título, avaliação, lance, foto, modalidade, data.
 *
 * SEGURANÇA DE CUSTO (cada lote = 1 request Bright Data):
 *   - PECINI_MAX_LOTES (default 40): limite de lotes por execução.
 *   - PECINI_DRYRUN (default '1'): NÃO grava — só busca, parseia e LOGA o que
 *     inseriria. A 1ª validação roda SECA; depois de conferir o parsing no log,
 *     rode com PECINI_DRYRUN=0. O workflow é dispatch-only (sem cron) até validar.
 *   - fetchViaBrightData respeita o teto semanal global (compartilhado com os
 *     demais consumidores) — se estourar, retorna null e o scraper para gentil.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
// NOTA (11/08): aqui o `null` do fetchViaBrightData é um fallback DELIBERADO (tenta o
// caminho grátis/residencial, e o pago é a segunda chance) — por isso este arquivo segue
// na linha de base do verificador de padrões em vez de migrar para `buscarViaBrightData`.
// O que fecha o buraco perigoso é outra coisa: coleta com zero lote agora sai com código
// 1 e grava `fonte_saude` 'falhou', e o gate só carimba "coletei" com linha no acervo.
import { fetchViaBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { extrairGenerico, extrairData, checarQualidade, extrairAreaM2} from './lib/scraper-core.mjs';
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { nomeiaUmDocumento } from '../api/_doc-scan.js';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

const BASE = 'https://www.pecinileiloes.com.br';
const MAX_LOTES = Number(process.env.PECINI_MAX_LOTES || 40);
const DRYRUN = process.env.PECINI_DRYRUN !== '0'; // default: dry-run (não grava)
const DEBUG = process.env.PECINI_DEBUG === '1';   // dumpa contexto dos R$ p/ achar os rótulos reais
let debugRestante = Number(process.env.PECINI_DEBUG_N || 3); // primeiros lotes (log enxuto)
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Busca crua via Web Unlocker (com teto de custo). Retorna o HTML/XML ou null.
async function bd(url, { proposito = 'pecini', timeoutMs = 45000 } = {}) {
  if (process.env.PECINI_HEADLESS === '1') {   // runner residencial: Chromium real de IP de casa, SEM Bright Data
    return await fetchHeadless(url, { timeoutMs });
  }
  const r = await fetchViaBrightData(url, { proposito, timeoutMs });
  if (!r || !r.ok) return null;
  return await r.text().catch(() => null);
}

// Tipo do imóvel a partir do título (normalizarTipo do scraper principal não é
// exportado; heurística simples e suficiente p/ o filtro da busca).
function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Resolve href relativo → absoluto no domínio do Pecini (o _abs do core não é exportado).
function absPecini(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return 'https:' + href;
  if (/^\//.test(href)) return BASE + href;
  return `${BASE}/${String(href).replace(/^\.?\//, '')}`;
}

// Extrai os DOCUMENTOS (PDFs) da página do lote — o Pecini serve em
// /arquivos/Leiloes/Docs/*.pdf. Coleta todo <a href>.pdf, classifica por rótulo/nome e
// monta os anexos. Zero-regressão: sem PDF na página, retorna [] e o comportamento é o
// de hoje (link_edital = página do lote, sem matrícula). Só ADICIONA cobertura.
// Id/caminho do documento escondido num atributo da âncora (`data-arquivo`, `data-url`,
// `data-id`, `onclick="abrir('...')"`). Só devolve o que JÁ É caminho ou nome de arquivo —
// nunca inventa a URL a partir do padrão observado noutro link.
function idDeAtributo(atributos) {
  const txt = String(atributos || '');
  for (const re of [/data-(?:arquivo|url|href|src|file|documento)\s*=\s*["']([^"']+)["']/i,
                    /on[a-z]+\s*=\s*["'][^"']*?['"]([^'"]*\.(?:pdf|jpe?g|png|docx?))['"]/i]) {
    const v = (txt.match(re) || [])[1];
    if (v && /[^/]$/.test(v)) return v;
  }
  return null;
}

function extrairDocs(html) {
  const anexos = [];
  const vistos = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absPecini(m[1]);
    if (!url || vistos.has(url)) continue; vistos.add(url);
    // DECODIFICA ENTIDADES ANTES DE CLASSIFICAR (17/08). O rótulo vinha cru: um link
    // "Matr&#xED;cula" não casava com /matr[íi]cul/ e a matrícula que EXISTE no site do
    // leiloeiro nunca virava anexo de matrícula — o cliente lia "Matrícula: no site" com o
    // documento publicado. A prova estava no acervo: anexo gravado como "Edital do Leil&#xE3;o".
    const rotulo = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const alvo = `${rotulo} ${url}`.toLowerCase();
    const tipo = /matr[íi]cul/.test(alvo) ? 'matricula'
      : /edital/.test(alvo) ? 'edital'
      : /laudo|avalia[çc]/.test(alvo) ? 'laudo'
      : 'anexo';
    anexos.push({ nome: (rotulo || tipo).slice(0, 60), url, tipo });
  }
  // SEGUNDA PASSADA: link cujo RÓTULO diz o que é, mesmo sem terminar em .pdf. O laço acima
  // só aceita href .pdf — se o leiloeiro serve o documento por rota de download/visualizador
  // (`/download?id=`, `/documento/123`), ele some. Aqui só entra o que o TEXTO do link
  // identifica, para não varrer o menu do site inteiro: nada de href genérico.
  for (const m of html.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const atributos = `${m[1] || ''} ${m[3] || ''}`;
    let url = absPecini(m[2]);
    if (!url || /\.pdf(\?|$)/i.test(url)) continue;
    const rotulo = decodificarEntidades((m[4] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!rotulo || rotulo.length > 60) continue;
    const tipo = /matr[íi]cul/i.test(rotulo) ? 'matricula'
      : /edital/i.test(rotulo) ? 'edital'
      : /laudo|avalia[çc]/i.test(rotulo) ? 'laudo'
      : null;
    if (!tipo) continue;
    // O href pode ser a ROTA e não o arquivo (`/preview/`), com o id do documento guardado
    // num atributo que o JS da página usa. Tenta recuperar dali — e SÓ dali: nada é montado
    // a partir de palpite sobre o formato da URL.
    if (!nomeiaUmDocumento(url)) url = absPecini(idDeAtributo(atributos)) || url;
    // Continua sem nomear documento nenhum → não é anexo. Ver `nomeiaUmDocumento`: um link
    // rotulado "Matrícula" que aponta para a pasta faz a ficha prometer o que não entrega.
    if (!nomeiaUmDocumento(url)) continue;
    if (vistos.has(url)) continue;
    vistos.add(url);
    anexos.push({ nome: rotulo.slice(0, 60), url, tipo });
  }

  const ordem = { matricula: 0, edital: 1, laudo: 2, anexo: 3 };
  anexos.sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
  return anexos;
}

// "barreiras-ba" → { cidade: 'Barreiras', uf: 'BA' } (o slug do lote traz cidade+UF).
function cidadeUfDoSlug(slug) {
  const m = String(slug || '').match(/^(.+)-([a-z]{2})$/i);
  if (!m) return { cidade: null, uf: null };
  const cidade = m[1].split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { cidade: cidade || null, uf: m[2].toUpperCase() };
}

// Enumera lotes do sitemap. Tolerante a 2 formatos: URLs /lote/{slug}/{id}/ (em
// <loc>/<link>/href) e feed de listings (home_listing_id + city + region).
function parseSitemap(xml) {
  const lotes = new Map(); // id -> { id, loteUrl, cidade, uf }
  for (const m of xml.matchAll(/\/lote\/([a-z0-9-]+)\/(\d+)\/?/gi)) {
    const id = m[2];
    if (!lotes.has(id)) {
      const { cidade, uf } = cidadeUfDoSlug(m[1]); // cidade/UF vêm do slug da URL
      lotes.set(id, { id, loteUrl: `${BASE}/lote/${m[1].toLowerCase()}/${id}/`, cidade, uf });
    }
  }
  for (const bl of xml.matchAll(/<listing\b[\s\S]*?<\/listing>/gi)) {
    const b = bl[0];
    const id = (b.match(/<home_listing_id>\s*([^<]+?)\s*<\/home_listing_id>/i) || [])[1]?.trim();
    if (!id) continue;
    const cidade = (b.match(/<city>\s*([^<]+?)\s*<\/city>/i) || [])[1]?.trim() || null;
    const uf = (b.match(/<region>\s*([^<]+?)\s*<\/region>/i) || [])[1]?.trim() || null;
    const rec = lotes.get(id) || { id, loteUrl: null, cidade: null, uf: null };
    if (cidade) rec.cidade = cidade;
    if (uf) rec.uf = uf;
    lotes.set(id, rec);
  }
  return [...lotes.values()];
}

// RÓTULO DA PRAÇA. Exige o ORDINAL (1º/2º/1ª/2ª) ou a palavra "Público" antes de "Leilão" —
// um "Leilão:" solto aparece em menu e em texto corrido, e aceitá-lo transformaria qualquer
// R$ da página em lance. O regex antigo pedia "Público Leilão" e essa fonte escreve só
// "1º Leilão:", que é o suficiente para identificar a praça sem abrir a porta.
const RE_PRACA_ROTULO = /(?:[12]\s*[ºªo°a]\s*|P\S*blico\s+)Leil\S*o/i;
const RE_PRACA_VALOR = /(?:[12]\s*[ºªo°a]\s*|P\S*blico\s+)Leil\S*o\s*:?\s*R\$\s*([\d.]+,\d{2})/gi;

// Parseia a página de detalhe: base genérica (og/ld+json/valores) + refinamentos
// específicos do Pecini (rótulos Avaliação/Lance e trimpath ValorMinimoLance...).
function parseDetalhe(html, rec) {
  const base = extrairGenerico(html, rec.loteUrl) || {};
  // DECODIFICA AS ENTIDADES (17/08). Só o `&nbsp;` era tratado, e o resto do texto chegava cru
  // aos regexes de rótulo. O recon com PECINI_DEBUG mostrou que a página escreve
  // `1&ordm; Leil&atilde;o: R$ 25.789,00` — ou seja, nem `1º` nem `Leilão` existem no texto que
  // era testado. Foi por isso que 10 dos 21 lotes novos saíram com `valor_minimo = 0` e foram
  // descartados: o lance ESTAVA na página, escrito numa forma que nada aqui conseguia ler.
  // É a terceira vez no dia que a mesma entidade não decodificada aparece com outra roupa
  // (rótulo de anexo, descrição do corpo e agora o lance).
  const txt = decodificarEntidades(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');

  // Valores pelos rótulos REAIS do Pecini (recon via PECINI_DEBUG):
  //   "Valor de Avaliação (dd/mm/aaaa): R$ X"     → avaliação (a data no meio quebrava o regex antigo)
  //   "1º Leilão: R$ X" / "2º Leilão: R$ Y" (com ou sem "Público") → praças (lance mínimo)
  // Ignoramos "Incremento", "Exercício da Preferência" e o filtro "Faixa de Preço".
  // Faixa plausível p/ imóvel: piso R$1.000, teto R$500mi. Sem match → 0 → descartado.
  const plaus = (v) => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const avalLabel = plaus(num((txt.match(/Avalia\S*o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const pracas = [];
  for (const m of txt.matchAll(RE_PRACA_VALOR)) pracas.push(num(m[1]));
  for (const m of html.matchAll(/ValorMinimoLance(?:Primeira|Segunda)Praca["'\s:=]+R?\$?\s*([\d.]+,\d{2})/gi)) pracas.push(num(m[1]));
  const pracasValidas = pracas.map(plaus).filter(v => v > 0);
  const valorMinimo = pracasValidas.length ? Math.min(...pracasValidas) : 0;
  // A 1ª praça abre pelo valor de avaliação → se não houver rótulo de avaliação, usa a MAIOR praça.
  const avaliacao = avalLabel || (pracasValidas.length ? Math.max(...pracasValidas) : 0);

  // RECON: com PECINI_DEBUG=1 dumpa o contexto de cada "R$ ..." (rótulo à esquerda) p/
  // descobrir os rótulos REAIS do site sem acesso direto (o proxy bloqueia o Pecini daqui).
  //
  // MORA AQUI, e não antes de ler os valores, de propósito (17/08): a coleta perdeu 10 dos 21
  // lotes novos por `valor_minimo = 0`, e o debug limitado aos 3 PRIMEIROS lotes despeja
  // justamente os que deram certo — a amostra que não precisa de recon. Agora o dump sai
  // SEMPRE que o lance não foi lido, que é a única página com algo a ensinar.
  if (DEBUG && (debugRestante > 0 || !valorMinimo)) {
    if (debugRestante > 0) debugRestante--;
    console.log(`\n[DEBUG ${rec.id}] ${valorMinimo ? '' : '(SEM LANCE LIDO) '}contextos de R$ (texto):`);
    for (const m of txt.matchAll(/(.{0,45})R\$\s*([\d.]+(?:,\d{2})?)/g)) {
      console.log(`   …${m[1].trim()} » R$ ${m[2]}`);
    }
    const trimp = [...html.matchAll(/(Valor\w*|Lance\w*|Avalia\w*)["'\s:=]{1,4}R?\$?\s*([\d.]+,\d{2})/gi)].map(x => `${x[1]}=${x[2]}`);
    if (trimp.length) console.log(`   [trimpath/attrs] ${trimp.join(' · ')}`);
  }

  // Modalidade: "Público Leilão" (1ª/2ª praça) = leilão, não venda direta (que
  // aparece no menu do site em toda página). "extrajudicial" contém "judicial",
  // então usa lookbehind p/ não classificar errado.
  const temPracas = RE_PRACA_ROTULO.test(txt) || /[12][ªa]\s*pra[çc]a/i.test(txt);
  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : (temPracas || /extrajudicial/i.test(txt)) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta'
    : 'extrajudicial';
  // ÁREA (17/08): era `txt.match(/(\d+)\s*m²/)` — exigia o caractere `m²` (site que escreve
  // "m2" saía sem área) e pegava a PRIMEIRA ocorrência da página, que num portal de leilão
  // costuma ser o filtro de busca, não o imóvel. `extrairAreaM2` prioriza área ROTULADA
  // (construída/privativa) e aceita as variações de unidade. Procura primeiro na DESCRIÇÃO —
  // que desde hoje vem do corpo da página, não da meta tag de marketing — e só depois na
  // página inteira, porque a descrição é o texto que fala do imóvel e o resto é o site.
  const descImovel = (base.descricao || '');
  const area = extrairAreaM2(descImovel) || extrairAreaM2(txt);

  // Documentos do lote (matrícula/edital/laudo) a partir dos PDFs da própria página.
  const anexos = extrairDocs(html);
  const matriculaDoc = anexos.find(a => a.tipo === 'matricula')?.url || null;
  const editalDoc = anexos.find(a => a.tipo === 'edital')?.url || null;

  // Página genérica (lote inexistente/redirect p/ a home): og:image é o ícone do
  // site (apple-touch-icon / Themes) e/ou título institucional. Marca p/ pular.
  const paginaInvalida = !base.link_foto
    || /apple-touch-icon|Themes\/DefaultClean|\/Content\/images\//i.test(base.link_foto || '')
    || /^Pecini Leil[õo]es\s*[|-]/i.test((base.titulo || '').trim());

  return {
    titulo: (base.titulo || `Imóvel Pecini ${rec.id}`).slice(0, 180),
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao,
    valor_minimo: valorMinimo,
    modalidade,
    area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: base.numero_matricula || null,
    link_matricula: matriculaDoc,
    link_edital_doc: editalDoc,
    anexos: anexos.length ? anexos : null,
    paginaInvalida,
  };
}

// Monta a linha compatível com imoveis_leilao (mesmos campos computados do
// salvarImoveis: ativo/viavel/score/desconto/atualizado_em).
function montarRow(rec, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  return {
    fonte: 'PECINI',
    fonte_id: `pecini_${rec.id}`,
    titulo: det.titulo,
    tipo: inferirTipo(det.titulo),
    modalidade: det.modalidade,
    estado: (rec.uf || '').toString().toUpperCase().slice(0, 2) || null,
    cidade: rec.cidade || null,
    valor_avaliacao: va,
    valor_minimo: vm,
    area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    // Edital REAL (PDF) quando a página o expõe; senão a página do lote (comportamento atual).
    link_edital: det.link_edital_doc || rec.loteUrl,
    url_lote: rec.loteUrl,
    link_matricula: det.link_matricula || null,
    anexos: det.anexos,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula,
    leiloeiro: 'Pecini Leilões',
    data_leilao: det.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  // Bright Data só no modo pago (CI); no runner RESIDENCIAL (PECINI_HEADLESS=1) o
  // Chromium real de IP de casa dispensa o proxy.
  if (!brightDataDisponivel() && process.env.PECINI_HEADLESS !== '1') {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — Pecini só é acessível via Web Unlocker (ou use PECINI_HEADLESS=1 num IP residencial). Abortado.');
    process.exit(1);
  }
  console.log(`PECINI ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_LOTES} lote(s)/run`);

  // 1) Sitemap → enumeração (1 request). Timeout maior: o feed pode ser grande e
  //    o Web Unlocker demora a resolver Cloudflare (45s estourou na 1ª validação).
  const xml = await bd(`${BASE}/sitemap.xml`, { timeoutMs: 110000 });
  if (!xml) { console.error('sitemap.xml não veio (teto BD atingido ou erro). Abortado.'); return; }
  let lotes = parseSitemap(xml);
  console.log(`sitemap: ${lotes.length} lote(s) enumerados (com URL: ${lotes.filter(l => l.loteUrl).length}).`);
  lotes = lotes.filter(l => l.loteUrl);
  if (!lotes.length) {
    console.error('nenhuma URL de lote no sitemap — estrutura pode ter mudado. Raw[0..600]:');
    console.error(xml.slice(0, 600).replace(/\s+/g, ' '));
    return;
  }

  // Prioriza lotes NOVOS (fonte_id ainda não no banco); execuções seguintes cobrem o resto.
  const ids = lotes.map(l => `pecini_${l.id}`);
  const existentes = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
    for (const r of data || []) existentes.add(r.fonte_id);
  }
  const novos = lotes.filter(l => !existentes.has(`pecini_${l.id}`));
  const alvo = (novos.length ? novos : lotes).slice(0, MAX_LOTES);
  console.log(`no banco: ${existentes.size} · novos: ${novos.length} · processando: ${alvo.length}`);

  // 2) Detalhe de cada lote alvo.
  const prontos = [];
  let semDetalhe = 0, reprovados = 0;
  for (const rec of alvo) {
    const html = await bd(rec.loteUrl);
    if (!html) { semDetalhe++; console.log(`- ${rec.id}: detalhe não veio (teto BD?)`); continue; }
    const det = parseDetalhe(html, rec);
    if (det.paginaInvalida) { semDetalhe++; console.log(`- ${rec.id}: página genérica/sem lote (pulado)`); continue; }
    const row = montarRow(rec, det);
    const q = checarQualidade(row, { estrito: false });
    console.log(`  ${rec.id} ${rec.cidade || '?'}/${rec.uf || '?'} · aval R$${row.valor_avaliacao} · min R$${row.valor_minimo} · desc ${row.desconto_percentual ?? '?'}% · foto ${row.link_foto ? 'sim' : 'NÃO'} · ${row.modalidade}${q.descartar ? ' · DESCARTADO(' + q.faltando.join(',') + ')' : (q.faltando.length ? ' · faltando ' + q.faltando.join(',') : ' · OK')}`);
    if (q.descartar) { reprovados++; continue; }
    prontos.push(row);
    await sleep(400); // gentileza entre requisições
  }

  console.log(`\nResumo: ${prontos.length} prontos · ${reprovados} descartados · ${semDetalhe} sem detalhe.`);
  // Zero pronto não é "a fonte está vazia" — é coleta quebrada até prova em contrário.
  // Sai com erro E deixa a linha em `fonte_saude`: sem isso a fonte some do monitor
  // (nenhuma linha nova) e o acervo encolhe em silêncio. Ver scraper-rj.mjs, 11/08.
  if (!prontos.length) {
    await registrarSaude(supabase, 'PECINI', [], 'principal',
      { ok: false, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: `nada pronto (${semDetalhe} sem detalhe, ${reprovados} reprovados)` });
    console.error('nada a gravar. Saindo com erro para não carimbar coleta que não coletou.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra do que inseriria:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log(`\nPara gravar de verdade, rode com PECINI_DRYRUN=0.`);
    return;
  }

  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis PECINI gravados/atualizados.`);
  // SAÚDE DA FONTE (08/08): entra no monitor de regressão junto das demais. Antes esta fonte
  // não escrevia em `fonte_saude`, então nunca ganhava piso aprendido e uma quebra passaria batido.
  await registrarSaude(supabase, 'PECINI', prontos, 'principal');
  // Auto-aprendizado: registra o que este scraper sabe na base de conhecimento.
  await registrarConhecimento(supabase, {
    fonte: 'PECINI', plataforma: 'ASP.NET-DefaultClean', acesso: 'brightdata', custo: 'pago',
    anti_bot: 'cloudflare', enumeracao: 'sitemap', url_lote: '/lote/{slug}/{id}/',
    scraper: 'scraper-pecini.mjs', qualidade: qualidadeColeta(prontos),
  });
}

// `process.exit(0)` FIXO apagava o `process.exitCode = 1` que o caminho "nada a gravar"
// acabara de definir — a coleta falhava e o processo saía verde mesmo assim. Agora o
// código de saída é o que o main decidiu (0 por padrão, 1 quando não coletou nada).
main()
  .then(() => fecharHeadless().finally(() => process.exit(process.exitCode || 0)))
  .catch(e => { console.error(e); fecharHeadless().finally(() => process.exit(1)); });
