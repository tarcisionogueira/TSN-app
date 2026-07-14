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
import { fetchViaBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';

const BASE = 'https://www.pecinileiloes.com.br';
const MAX_LOTES = Number(process.env.PECINI_MAX_LOTES || 40);
const DRYRUN = process.env.PECINI_DRYRUN !== '0'; // default: dry-run (não grava)
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Busca crua via Web Unlocker (com teto de custo). Retorna o HTML/XML ou null.
async function bd(url, { proposito = 'pecini', timeoutMs = 45000 } = {}) {
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

// Parseia a página de detalhe: base genérica (og/ld+json/valores) + refinamentos
// específicos do Pecini (rótulos Avaliação/Lance e trimpath ValorMinimoLance...).
function parseDetalhe(html, rec) {
  const base = extrairGenerico(html, rec.loteUrl) || {};
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Valores: SÓ pelos rótulos específicos (Avaliação/Lance) e pelo template
  // trimpath — NÃO caímos no min/max genérico do extrairGenerico, que pegava lixo
  // (dry-run mostrou avaliação R$100mi e lance R$10). Faixa plausível p/ imóvel:
  // piso R$1.000 (descarta taxas/placeholders), teto R$500mi. Sem match plausível
  // fica 0 → checarQualidade descarta (melhor que gravar valor errado).
  const plaus = (v) => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const avaliacao = plaus(num((txt.match(/Avalia[çc][ãa]o[:\s]*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const lances = [];
  for (const m of txt.matchAll(/Lance\s*(?:Inicial|M[íi]nimo|Atual)[:\s]*R\$\s*([\d.]+,\d{2})/gi)) lances.push(num(m[1]));
  for (const m of html.matchAll(/ValorMinimoLance(?:Primeira|Segunda)Praca["'\s:=]+R?\$?\s*([\d.]+,\d{2})/gi)) lances.push(num(m[1]));
  const lancesValidos = lances.map(plaus).filter(v => v > 0);
  const valorMinimo = lancesValidos.length ? Math.min(...lancesValidos) : 0;

  const modalidade = /venda\s*direta/i.test(txt) ? 'venda_direta'
    : /judicial/i.test(txt) ? 'judicial' : 'extrajudicial';
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m²/i) || [])[1]);

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
    link_edital: rec.loteUrl,
    url_lote: rec.loteUrl,
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
  if (!brightDataDisponivel()) {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — Pecini só é acessível via Web Unlocker. Abortado.');
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
  if (!prontos.length) { console.log('nada a gravar.'); return; }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra do que inseriria:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log(`\nPara gravar de verdade, rode com PECINI_DRYRUN=0.`);
    return;
  }

  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis PECINI gravados/atualizados.`);
}

main().catch(e => { console.error(e); process.exit(1); });
