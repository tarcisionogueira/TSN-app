/**
 * Scraper EMILIOMATOS — plataforma Superbid/MBV (white-label SSR)
 * ──────────────────────────────────────────────────────────────
 * Modelado no scraper-soleon.mjs (listagem SSR → detalhe → upsert em imoveis_leilao).
 * Recon runtime de 20/08 (runs 32357329191/32366905892/32368577895) provou:
 *   - Plataforma é Superbid/MBV, NÃO Vlance (por isso /core/api/get-lotes deu 0).
 *   - Listagem: /busca/segmento/imoveis?page=N — 30 lotes/página, SSR. ⚠️ usar ?page= (não ?pagina=).
 *   - Lote individual: /imoveis/<tipo>/<slug>-<ID>. ≥300 imóveis no acervo.
 *   - Preço por OFERTA INICIAL/praça (avaliação = maior, mínimo = menor); Entrada/Parcela NÃO
 *     são valor do lote. Praça encerrada = leilão morto → pulado. (Ver lib/emiliomatos-parse.mjs.)
 *   - Cloudflare: IP de datacenter falha; precisa Bright Data (ou IP residencial).
 *
 * SEGURANÇA DE CUSTO (igual ao SOLEON):
 *   - EMILIOMATOS_MAX_LOTES (40): teto de lotes NOVOS processados por execução.
 *   - EMILIOMATOS_MAX_PAGES (15): páginas da listagem enumeradas por execução.
 *   - EMILIOMATOS_DRYRUN (default '1'): NÃO grava — enumera, parseia e LOGA o que inseriria.
 *   - EMILIOMATOS_DEBUG  (default '0'): dumpa listagem + 1 detalhe (recon-first).
 *   - Bright Data via buscarViaBrightData(proposito='emiliomatos') → respeita a cota semanal.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import {
  FONTE, LEILOEIRO, BASE, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from './lib/emiliomatos-parse.mjs';

const SEG = '/busca/segmento/imoveis';
const MAX_LOTES = Number(process.env.EMILIOMATOS_MAX_LOTES || 40);
const MAX_PAGES = Number(process.env.EMILIOMATOS_MAX_PAGES || 15);
const DRYRUN = process.env.EMILIOMATOS_DRYRUN !== '0';
const DEBUG = process.env.EMILIOMATOS_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));
let SEM_COTA = false;
let ENUMERADOS = null;

async function fetchEM(url, { timeoutMs = 45000 } = {}) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Accept': 'text/html,application/xhtml+xml' } });
    clearTimeout(t);
    if (r.ok) {
      const html = await r.text().catch(() => '');
      if (html && !ehChallenge(html)) return { html, via: 'gratis' };
    }
  } catch { /* cai p/ Bright Data */ }
  if (process.env.EMILIOMATOS_NO_BD === '1') return { html: null, via: 'sem-bd' };
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'emiliomatos', timeoutMs, exigirOk: false });
    if (!bd.ok) return { html: null, via: 'bloqueado' };
    return { html: await bd.text().catch(() => null), via: 'brightdata' };
  } catch (e) {
    if (e instanceof ErroBrightData) {
      if (e.semCota) SEM_COTA = true;
      return { html: null, via: e.semCota ? 'sem-cota' : 'bloqueado', semCota: !!e.semCota };
    }
    throw e;
  }
}

async function enumerar() {
  const urls = new Map(); let via = null;
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = `${BASE}${SEG}${p > 1 ? `?page=${p}` : ''}`;
    const { html, via: v } = await fetchEM(url);
    if (!html) break;
    via = via || v;
    const antes = urls.size;
    for (const [id, u] of extrairUrlsDeLote(html)) urls.set(id, u);
    if (DEBUG) console.log(`   pág ${p} (${v}): +${urls.size - antes} (total ${urls.size})`);
    if (urls.size === antes) break;
    await sleep(400);
  }
  ENUMERADOS = urls.size;
  return { urls: [...urls.values()], via };
}

async function debugRecon() {
  console.log(`🔎 EMILIOMATOS RECON — confirma padrões de URL + parser\n`);
  const { html, via } = await fetchEM(`${BASE}${SEG}`);
  if (!html) { console.log('listagem não veio (challenge/teto).'); return; }
  console.log(`listagem via ${via}, ${html.length} bytes`);
  const lotes = [...extrairUrlsDeLote(html).values()];
  console.log(`extrairUrlsDeLote → ${lotes.length}: ${JSON.stringify(lotes.slice(0, 6))}`);
  if (lotes[0]) {
    const { html: dh, via: dv } = await fetchEM(lotes[0]);
    if (dh) {
      const det = parseDetalhe(dh, lotes[0]);
      console.log(`── detalhe ${lotes[0]} (via ${dv}, ${dh.length} bytes)`);
      console.log('   →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
    }
  }
  console.log('\n✅ RECON concluído.');
}

async function main() {
  if (DEBUG) {
    if (!brightDataDisponivel()) console.log('(aviso: Bright Data ausente — só a via grátis será tentada)');
    await debugRecon();
    return;
  }
  console.log(`EMILIOMATOS ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_LOTES} lote(s)/run · até ${MAX_PAGES} págs`);
  const { urls, via } = await enumerar();
  console.log(`enumerados ${urls.length} lote(s) (via ${via})`);

  let prontos = [], encerrados = 0;
  if (urls.length) {
    const ids = urls.map(u => `emiliomatos_${idDaUrl(u)}`);
    const existentes = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      // padrao-ok: leitura best-effort de dedup; erro → data undefined → reprocessa lote conhecido (upsert idempotente), nunca corrompe. Mesmo padrão do scraper-soleon.mjs.
      const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
      for (const r of data || []) existentes.add(r.fonte_id);
    }
    const novos = urls.filter(u => !existentes.has(`emiliomatos_${idDaUrl(u)}`));
    const alvo = (novos.length ? novos : urls).slice(0, MAX_LOTES);
    console.log(`no banco ${existentes.size} · novos ${novos.length} · processando ${alvo.length}`);
    let sem = 0, reprov = 0;
    for (const url of alvo) {
      const { html } = await fetchEM(url);
      if (!html) { sem++; continue; }
      const det = parseDetalhe(html, url);
      if (det.encerrado) { encerrados++; continue; }   // leilão morto → não polui o acervo
      const row = montarRow(url, det);
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { reprov++; continue; }
      prontos.push(row);
      await sleep(350);
    }
    console.log(`${prontos.length} prontos · ${encerrados} encerrados (pulados) · ${reprov} descartados · ${sem} sem detalhe`);
  }

  if (!prontos.length) {
    await registrarSaude(supabase, FONTE, [], 'emiliomatos', {
      ok: false, semCota: SEM_COTA, enumerados: ENUMERADOS,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: SEM_COTA
        ? 'SEM COTA Bright Data — coleta não tentada (orçamento, não regressão da fonte)'
        : (encerrados ? `execução sem lote pronto (${encerrados} praças encerradas)` : 'execução sem nenhum lote pronto'),
    });
    console.error(SEM_COTA ? 'sem cota Bright Data — orçamento, não regressão.' : 'nada a gravar. Saindo com erro.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3).map(r => ({ fonte_id: r.fonte_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado, aval: r.valor_avaliacao, min: r.valor_minimo, desc: r.desconto_percentual, area: r.area_m2 })), null, 2));
    console.log('\nPara gravar, rode com EMILIOMATOS_DRYRUN=0.');
    return;
  }
  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis EMILIOMATOS gravados/atualizados.`);
  await registrarSaude(supabase, FONTE, prontos, 'emiliomatos', { enumerados: ENUMERADOS });
  await registrarConhecimento(supabase, {
    fonte: FONTE, plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'gratis+brightdata', custo: 'misto',
    anti_bot: 'cloudflare', enumeracao: '/busca/segmento/imoveis?page=N', url_lote: '/imoveis/<tipo>/<slug>-<ID>',
    scraper: 'scraper-emiliomatos.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main().catch(e => { console.error(e); process.exit(1); });
