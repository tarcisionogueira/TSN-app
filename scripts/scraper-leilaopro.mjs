/**
 * Scraper LEILAOPRO — plataforma "LeilãoPro Core" (artisticweb/leilaodetran, SSR)
 * ─────────────────────────────────────────────────────────────────────────────
 * Serve MÚLTIPLOS leiloeiros (fonte por tenant): leffaleiloes, oscarleiloes.
 * Recon runtime de 20/08 (workflow recon-leilaopro, lote leffa 7208 = golden record):
 *   - SSR. Categoria imóveis: /leilao/lotes/imoveis (página única, sem ?pagina real).
 *   - Lote: /leilao/<slug>/lote_id/<ID>.
 *   - Preço POR RÓTULO: "LANCE INICIAL" = avaliação (1º leilão); "LANCE INICIAL 2º LEILÃO"
 *     = mínimo (≈50%); incremento/caução IGNORADOS. Sem 2º → mínimo = avaliação. (lib/leilaopro-parse.mjs)
 *   - Cidade/UF do título ("…CIDADE DE <cidade>/<UF>"); área do m² do título; docs em
 *     /uploads/media/documentos_leilao (edital) e /documentos_bem (matrícula/laudo).
 *   - Cloudflare/anti-bot: usa Bright Data (proposito='leilaopro', teto próprio 120).
 *
 * SEGURANÇA DE CUSTO (igual emiliomatos):
 *   - LEILAOPRO_TENANTS ('leffa'): tenants a coletar (csv). oscar precisa de recon próprio
 *     (a listagem migrou p/ oscar.leilao.br e voltou vazia em 20/08) — fora do default.
 *   - LEILAOPRO_MAX_LOTES (40) · LEILAOPRO_MAX_PAGES (3) · LEILAOPRO_DRYRUN (default '1').
 *   - LEILAOPRO_DEBUG ('0'): dumpa listagem + 1 detalhe.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from './lib/leilaopro-parse.mjs';

const CAT = '/leilao/lotes/imoveis';
const TENANTS_ALVO = (process.env.LEILAOPRO_TENANTS || 'leffa,oscar').split(',').map(s => s.trim()).filter(Boolean);
const MAX_LOTES = Number(process.env.LEILAOPRO_MAX_LOTES || 40);
const MAX_PAGES = Number(process.env.LEILAOPRO_MAX_PAGES || 3);
const DRYRUN = process.env.LEILAOPRO_DRYRUN !== '0';
const DEBUG = process.env.LEILAOPRO_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));
let SEM_COTA = false;

async function fetchLP(url, { timeoutMs = 45000 } = {}) {
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
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'leilaopro', timeoutMs, exigirOk: false });
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

async function enumerar(tenant) {
  const urls = new Map();
  let fetchOk = false;   // a listagem RESPONDEU (mesmo que sem lotes) — distingue "fonte vazia"
  for (let p = 1; p <= MAX_PAGES; p++) {   // de "não consegui buscar" (challenge/teto).
    const url = `${tenant.base}${CAT}${p > 1 ? `?pagina=${p}` : ''}`;
    const { html, via } = await fetchLP(url);
    if (!html) break;
    fetchOk = true;
    const antes = urls.size;
    for (const [id, u] of extrairUrlsDeLote(html, tenant.base)) urls.set(id, u);
    if (DEBUG) console.log(`   [${tenant.fonte}] pág ${p} (${via}): +${urls.size - antes} (total ${urls.size})`);
    if (urls.size === antes) break;   // página única (LeilãoPro não pagina de verdade) → para
    await sleep(400);
  }
  return { urls: [...urls.values()], fetchOk };
}

async function debugRecon() {
  for (const key of TENANTS_ALVO) {
    const tenant = TENANTS[key]; if (!tenant) { console.log(`tenant ${key} desconhecido`); continue; }
    console.log(`\n🔎 ${tenant.fonte} RECON — ${tenant.base}${CAT}`);
    const urls = await enumerar(tenant);
    console.log(`   ${urls.length} lote(s): ${JSON.stringify(urls.slice(0, 4))}`);
    if (urls[0]) {
      const { html, via } = await fetchLP(urls[0]);
      if (html) {
        const det = parseDetalhe(html, urls[0]);
        console.log(`   detalhe ${urls[0]} (via ${via}) →`, JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
      }
    }
  }
}

async function coletarTenant(tenant) {
  const { urls, fetchOk } = await enumerar(tenant);
  console.log(`[${tenant.fonte}] enumerados ${urls.length} lote(s)`);
  let prontos = [], encerrados = 0, sem = 0, reprov = 0;
  if (urls.length) {
    const ids = urls.map(u => `${tenant.fonte.toLowerCase()}_${idDaUrl(u)}`);
    const existentes = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      // padrao-ok: leitura best-effort de dedup; erro → reprocessa lote conhecido (upsert idempotente), nunca corrompe. Mesmo padrão do scraper-emiliomatos.mjs.
      const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
      for (const r of data || []) existentes.add(r.fonte_id);
    }
    const novos = urls.filter(u => !existentes.has(`${tenant.fonte.toLowerCase()}_${idDaUrl(u)}`));
    const alvo = (novos.length ? novos : urls).slice(0, MAX_LOTES);
    console.log(`[${tenant.fonte}] no banco ${existentes.size} · novos ${novos.length} · processando ${alvo.length}`);
    for (const url of alvo) {
      const { html } = await fetchLP(url);
      if (!html) { sem++; continue; }
      const det = parseDetalhe(html, url);
      if (det.encerrado) { encerrados++; continue; }
      const row = montarRow(url, det, tenant);
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { reprov++; continue; }   // sem valor/data, ou fração ideal → fora
      prontos.push(row);
      await sleep(350);
    }
  }
  console.log(`[${tenant.fonte}] ${prontos.length} prontos · ${encerrados} encerrados · ${reprov} descartados · ${sem} sem detalhe`);
  // fonteVazia = a listagem respondeu, sem NENHUM lote (não é falha: o leiloeiro só não tem
  // imóveis agora — caso do oscar em 20/08). Não é "não consegui coletar" (SEM_COTA/challenge).
  return { prontos, encerrados, fonteVazia: fetchOk && urls.length === 0 };
}

async function main() {
  if (DEBUG) {
    if (!brightDataDisponivel()) console.log('(aviso: Bright Data ausente — só a via grátis será tentada)');
    await debugRecon();
    return;
  }
  console.log(`LEILAOPRO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · tenants: ${TENANTS_ALVO.join(',')} · max ${MAX_LOTES}/tenant`);

  for (const key of TENANTS_ALVO) {
    const tenant = TENANTS[key];
    if (!tenant) { console.log(`tenant '${key}' desconhecido — pulando`); continue; }
    const { prontos, encerrados, fonteVazia } = await coletarTenant(tenant);

    if (!prontos.length) {
      // FONTE VAZIA (respondeu, 0 imóveis) NÃO é falha: não escreve linha de saúde — senão o
      // oscar (0 imóveis hoje) viraria alarme toda semana. Só registra saúde quando houve
      // ERRO real (sem cota / challenge) ou quando havia lotes mas nenhum ficou pronto.
      if (fonteVazia) { console.log(`[${tenant.fonte}] sem imóveis no momento — fonte vazia (sem alarme).`); continue; }
      await registrarSaude(supabase, tenant.fonte, [], 'leilaopro', {
        ok: false, semCota: SEM_COTA,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: SEM_COTA
          ? 'SEM COTA Bright Data — coleta não tentada (orçamento, não regressão da fonte)'
          : (encerrados ? `sem lote pronto (${encerrados} encerrados)` : 'sem nenhum lote pronto'),
      });
      console.error(`[${tenant.fonte}] nada a gravar.`);
      continue;
    }

    if (DRYRUN) {
      console.log(`[${tenant.fonte}] DRY-RUN amostra:`);
      console.log(JSON.stringify(prontos.slice(0, 3).map(r => ({ fonte_id: r.fonte_id, titulo: (r.titulo || '').slice(0, 50), cidade: r.cidade, estado: r.estado, aval: r.valor_avaliacao, min: r.valor_minimo, desc: r.desconto_percentual, area: r.area_m2 })), null, 2));
      continue;
    }
    const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error) { console.error(`[${tenant.fonte}] erro ao gravar:`, error.message); process.exitCode = 1; continue; }
    console.log(`✅ [${tenant.fonte}] ${prontos.length} imóveis gravados/atualizados.`);
    await registrarSaude(supabase, tenant.fonte, prontos, 'leilaopro', {});
    await registrarConhecimento(supabase, {
      fonte: tenant.fonte, plataforma: 'LeilãoPro Core (artisticweb/leilaodetran SSR)', acesso: 'gratis+brightdata', custo: 'misto',
      anti_bot: 'cloudflare', enumeracao: '/leilao/lotes/imoveis', url_lote: '/leilao/<slug>/lote_id/<ID>',
      scraper: 'scraper-leilaopro.mjs', qualidade: qualidadeColeta(prontos),
    });
  }
  if (DRYRUN) console.log('\nPara gravar, rode com LEILAOPRO_DRYRUN=0.');
}

main().catch(e => { console.error(e); process.exit(1); });
