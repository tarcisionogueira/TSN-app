/**
 * Scraper RJ Leilões (rjleiloes.com.br) — imóveis via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * Por que Bright Data (pago): o recon provou que o RJ está 100% atrás de Cloudflare
 * — TODO caminho responde 403 "Just a moment..." mesmo pelo Puppeteer no GitHub
 * Actions. Não há via grátis; o Web Unlocker é o único que resolve o desafio. Isso
 * segue o plano do agente: grátis primeiro (falhou), pago como SUPORTE necessário.
 *
 * SEGURANÇA DE CUSTO (cada request = 1 chamada Bright Data):
 *   - RJ_MAX_LOTES (default 40): teto de lotes por execução.
 *   - RJ_DRYRUN (default '1'): NÃO grava — só busca/parseia e loga o que inseriria.
 *   - RJ_DEBUG  (default '0'): dumpa a ESTRUTURA (sitemap + 1 lote) p/ afinar o parser
 *     — método recon-first. Roda com RJ_DEBUG=1 na 1ª vez (gasta ~2-3 requests).
 *   - fetchViaBrightData respeita o teto semanal global + sub-cota 'rj' → nunca estoura.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchViaBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

const BASE = 'https://www.rjleiloes.com.br';
const MAX_LOTES = Number(process.env.RJ_MAX_LOTES || 40);
const DRYRUN = process.env.RJ_DRYRUN !== '0'; // default: dry-run (não grava)
const DEBUG = process.env.RJ_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Busca crua via Web Unlocker (com teto de custo). Retorna o corpo (HTML/XML) ou null.
async function bd(url, { timeoutMs = 60000 } = {}) {
  if (process.env.RJ_HEADLESS === '1') {   // runner residencial: Chromium real (passa Cloudflare de IP residencial), SEM Bright Data
    const h = await fetchHeadless(url, { timeoutMs });
    if (DEBUG) console.log(`  headless ${url} → ${h ? h.length + ' bytes' : 'null'}`);
    return h;
  }
  const r = await fetchViaBrightData(url, { proposito: 'rj', timeoutMs });
  if (!r) { if (DEBUG) console.log(`  bd ${url} → null (teto/config)`); return null; }
  const body = await r.text().catch(() => null);
  if (DEBUG) console.log(`  bd ${url} → HTTP ${r.status} · ${body ? body.length : 0} bytes`);
  if (!r.ok) return null;
  return body;
}

function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Enumeração — plataforma SOLEON: a página do lote é /item/{id}/detalhes.
// Extrai da listagem (ou de qualquer HTML) as URLs de detalhe, normalizando (sem ?page).
function extrairUrlsDeLote(txt) {
  const urls = new Set();
  for (const m of txt.matchAll(/\/item\/(\d+)\/detalhes/gi)) {
    urls.add(`${BASE}/item/${m[1]}/detalhes`);
  }
  return [...urls];
}

// Parseia a página de detalhe: base genérica (og/ld+json/valores) + refinamentos RJ.
function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

  // Preço pelos RÓTULOS do SOLEON (limpos): "Lance Inicial: R$ X" e "Valor de
  // Avaliação: R$ X". Evita pegar Incremento/Comissão/Total (o min() cego pegava o
  // Incremento de R$ 2.000). Fallback robusto se o rótulo faltar.
  const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const rotLance = plaus(num((txt.match(/lance\s*(?:inicial|m[íi]nimo)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const rotAval = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const grandes = [...txt.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m => num(m[1])).filter(v => v >= 10000 && v <= 500_000_000);
  const avaliacao = rotAval || (grandes.length ? Math.max(...grandes) : 0);
  let valorMinimo = rotLance;
  if (!valorMinimo && grandes.length) {
    const semAval = grandes.filter(v => v !== avaliacao);
    valorMinimo = semAval.length ? Math.min(...semAval) : avaliacao;
  }

  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta' : 'extrajudicial';
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m²/i) || [])[1]);
  // cidade/UF: padrão "CIDADE/UF" no título/endereço (ex.: "ARACAJU/SE"). Sem hífen na
  // classe p/ não capturar o nome da rua antes do " - CIDADE/UF".
  const loc = ((base.titulo || '') + ' ' + txt).match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. ]{1,30})\/([A-Z]{2})\b/);
  const cidade = loc ? loc[1].trim().replace(/\s+/g, ' ') : null;
  const estado = loc ? loc[2] : null;
  const mat = (txt.match(/matr[íi]cula[^\d]{0,20}([\d.\-\/]{2,})/i) || [])[1] || null;

  // Documentos: PDFs e links rotulados (matrícula/edital/laudo).
  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  return {
    titulo: (base.titulo || '').slice(0, 180) || null,
    cidade,
    estado,
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao,
    valor_minimo: valorMinimo,
    modalidade,
    area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i),
    link_matricula: findDoc(/matr[íi]cula/i),
    anexos,
  };
}

function idDaUrl(url) {
  const m = String(url).match(/\/item\/(\d+)/i);
  return m ? m[1] : String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();
}

function montarRow(url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: 'RJLEILOES',
    fonte_id: `rj_${id}`,
    titulo: det.titulo || `Imóvel RJ ${id}`,
    tipo: inferirTipo(det.titulo || ''),
    modalidade: det.modalidade,
    cidade: det.cidade || null,
    estado: det.estado || null,
    valor_avaliacao: va,
    valor_minimo: vm,
    area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url,
    url_lote: url,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula,
    link_matricula: det.link_matricula,
    anexos: det.anexos,
    leiloeiro: 'RJ Leilões',
    data_leilao: det.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// RECON: plataforma SOLEON — os imóveis ficam na listagem /lotes/categoria/imoveis
// (o sitemap só tem categorias). Dumpa o padrão de URL do lote + paginação + 1 detalhe.
async function debugRecon() {
  console.log('🔎 RJ RECON v2 (via Bright Data) — plataforma SOLEON\n');
  const LIST = `${BASE}/lotes/categoria/imoveis`;
  const html = await bd(LIST, { timeoutMs: 90000 });
  if (!html) { console.log('listagem de imóveis não veio (teto BD?).'); return; }
  console.log(`listagem ${LIST}: ${html.length} bytes`);

  const lotes = extrairUrlsDeLote(html);
  console.log(`\n▓▓ lotes /item/{id}/detalhes na página 1 — ${lotes.length}:`);
  console.log('   ' + lotes.slice(0, 25).join('\n   '));

  const alvo = lotes[0] || null;
  if (alvo) {
    console.log(`\n── DETALHE amostra: ${alvo}`);
    const dh = await bd(alvo, { timeoutMs: 90000 });
    if (dh) {
      const det = parseDetalhe(dh, alvo);
      console.log('   parseDetalhe →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
      const t = dh.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.log('   R$ contexto:');
      for (const m of t.matchAll(/(.{0,45})R\$\s*([\d.]+,\d{2})/g)) console.log(`     …${m[1].trim()} » R$ ${m[2]}`);
      console.log('   matrícula ctx:', (t.match(/.{0,25}matr[íi]cula.{0,45}/i) || [''])[0].trim());
      console.log('   docs href amostra:', JSON.stringify([...dh.matchAll(/href=["']([^"']*(?:\.pdf|edital|matricula|laudo)[^"']*)["']/gi)].map(m => m[1]).slice(0, 6)));
    }
  } else {
    console.log('\n⚠️ nenhum /item/{id}/detalhes na listagem — amostra do HTML p/ inspeção:');
    console.log('   ' + html.slice(0, 1500).replace(/\s+/g, ' '));
  }
  console.log('\n✅ RECON v2 concluído.');
}

async function main() {
  // Bright Data só é exigido no modo pago (CI); no runner RESIDENCIAL (RJ_HEADLESS=1)
  // o Chromium real passa o Cloudflare de graça — o guard antigo abortava o modo de casa.
  if (!brightDataDisponivel() && process.env.RJ_HEADLESS !== '1') {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — RJ só é acessível via Web Unlocker (ou use RJ_HEADLESS=1 num IP residencial). Abortado.');
    process.exit(1);
  }
  if (DEBUG) { await debugRecon(); return; }

  console.log(`RJ LEILÕES ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_LOTES} lote(s)/run`);

  // 1) Enumeração: listagem de imóveis paginada (SOLEON: /lotes/categoria/imoveis?page=N).
  //    Para quando uma página não traz lote novo ou atinge o teto de páginas.
  const MAX_PAGES = Number(process.env.RJ_MAX_PAGES || 6);
  const setUrls = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const body = await bd(`${BASE}/lotes/categoria/imoveis?page=${p}`, { timeoutMs: 90000 });
    if (!body) break;
    const antes = setUrls.size;
    for (const u of extrairUrlsDeLote(body)) setUrls.add(u);
    console.log(`  página ${p}: +${setUrls.size - antes} lote(s) (total ${setUrls.size})`);
    if (setUrls.size === antes) break; // página sem novidade → fim
    await sleep(400);
  }
  const urlsLote = [...setUrls];
  if (!urlsLote.length) { console.error('Nenhum lote na listagem. Rode RJ_DEBUG=1 p/ inspecionar.'); return; }
  console.log(`Enumerados ${urlsLote.length} lote(s).`);

  // Prioriza os NOVOS (fonte_id ainda não no banco).
  const ids = urlsLote.map(u => `rj_${idDaUrl(u)}`);
  const existentes = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
    for (const r of data || []) existentes.add(r.fonte_id);
  }
  const novos = urlsLote.filter(u => !existentes.has(`rj_${idDaUrl(u)}`));
  const alvo = (novos.length ? novos : urlsLote).slice(0, MAX_LOTES);
  console.log(`no banco: ${existentes.size} · novos: ${novos.length} · processando: ${alvo.length}`);

  // 2) Detalhe de cada lote alvo.
  const prontos = [];
  let sem = 0, reprov = 0;
  for (const url of alvo) {
    const html = await bd(url, { timeoutMs: 90000 });
    if (!html) { sem++; continue; }
    const row = montarRow(url, parseDetalhe(html, url));
    const q = checarQualidade(row, { estrito: false });
    console.log(`  ${idDaUrl(url)} · aval R$${row.valor_avaliacao} · min R$${row.valor_minimo} · foto ${row.link_foto ? 'sim' : 'NÃO'} · ${row.modalidade}${q.descartar ? ' · DESCARTADO(' + q.faltando.join(',') + ')' : (q.faltando.length ? ' · faltando ' + q.faltando.join(',') : ' · OK')}`);
    if (q.descartar) { reprov++; continue; }
    prontos.push(row);
    await sleep(400);
  }
  console.log(`\nResumo: ${prontos.length} prontos · ${reprov} descartados · ${sem} sem detalhe.`);
  if (!prontos.length) { console.log('nada a gravar.'); return; }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 2), null, 2));
    console.log('\nPara gravar, rode com RJ_DRYRUN=0.');
    return;
  }
  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis RJ Leilões gravados/atualizados.`);
  // SAÚDE DA FONTE (08/08): entra no monitor de regressão junto das demais. Antes esta fonte
  // não escrevia em `fonte_saude`, então nunca ganhava piso aprendido e uma quebra passaria batido.
  await registrarSaude(supabase, 'RJLEILOES', prontos, 'principal');
  // Auto-aprendizado: registra o que este scraper sabe na base de conhecimento.
  await registrarConhecimento(supabase, {
    fonte: 'RJLEILOES', plataforma: 'SOLEON', acesso: 'brightdata', custo: 'pago',
    anti_bot: 'cloudflare', enumeracao: 'listagem_paginada', url_lote: '/item/{id}/detalhes',
    scraper: 'scraper-rj.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main()
  .then(() => fecharHeadless().finally(() => process.exit(0)))
  .catch(e => { console.error(e); fecharHeadless().finally(() => process.exit(1)); });
