/**
 * Scraper EMILIOMATOS — plataforma Superbid/MBV (white-label SSR)
 * ──────────────────────────────────────────────────────────────
 * Modelado no scraper-soleon.mjs (listagem SSR → detalhe → upsert em imoveis_leilao).
 * Recon runtime de 20/08 (run 32357329191/32366905892) provou:
 *   - Plataforma é Superbid/MBV, NÃO Vlance (por isso /core/api/get-lotes deu 0).
 *   - Listagem de imóveis: /busca/segmento/imoveis?page=N — 30 lotes/página, SSR.
 *     ⚠️ ?pagina= é IGNORADO (devolve pág 1); usar ?page=.
 *   - Lote individual: /imoveis/<tipo>/<slug>-<ID>. (/imoveis-<slug>-<id> SEM barra é
 *     página-carteira/rede, agrupa vários — NÃO é lote único, então ignoramos.)
 *   - ≥300 imóveis no acervo (10 págs × 30, ainda subindo).
 *   - Site atrás de Cloudflare: IP de datacenter falha; precisa Bright Data (ou IP residencial).
 *
 * SEGURANÇA DE CUSTO (igual ao SOLEON):
 *   - EMILIOMATOS_MAX_LOTES (default 40): teto de lotes NOVOS processados por execução.
 *   - EMILIOMATOS_MAX_PAGES (default 15): páginas da listagem enumeradas por execução.
 *   - EMILIOMATOS_DRYRUN (default '1'): NÃO grava — enumera, parseia e LOGA o que inseriria.
 *   - EMILIOMATOS_DEBUG  (default '0'): dumpa listagem + 1 detalhe p/ conferir o parser (recon-first).
 *   - Bright Data via buscarViaBrightData(proposito='emiliomatos') → respeita a cota semanal.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
import { registrarSaude } from './_saude-fonte.mjs';

const FONTE = 'EMILIOMATOS';
const LEILOEIRO = 'Emílio Matos Leilões';
const BASE = 'https://emiliomatosleiloes.com.br';
const SEG = '/busca/segmento/imoveis';

const MAX_LOTES = Number(process.env.EMILIOMATOS_MAX_LOTES || 40);
const MAX_PAGES = Number(process.env.EMILIOMATOS_MAX_PAGES || 15);
const DRYRUN = process.env.EMILIOMATOS_DRYRUN !== '0';
const DEBUG = process.env.EMILIOMATOS_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));
let SEM_COTA = false;
let ENUMERADOS = null;

// Fetch "grátis primeiro" (residencial dispensa proxy); datacenter cai no Web Unlocker.
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

function inferirTipo(titulo = '', url = '') {
  const t = (titulo + ' ' + url).toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote|gleba|[áa]rea|fazenda|s[íi]tio|ch[áa]cara|rural/.test(t)) return /fazenda|s[íi]tio|ch[áa]cara|rural/.test(t) ? 'rural' : 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|andar/.test(t)) return 'comercial';
  return 'outros';
}

// Só lote INDIVIDUAL: /imoveis/<tipo>/<slug>-<ID> (exige subpath após /imoveis/).
// As páginas /imoveis-<slug>-<id> (sem barra) são carteiras/redes — agrupam vários, ignoradas.
function extrairUrlsDeLote(html) {
  const urls = new Map(); // id → url absoluta
  for (const m of html.matchAll(/href=["'](\/imoveis\/[^"']+?-(\d{4,}))["']/gi)) {
    try { urls.set(m[2], new URL(m[1], BASE).href); } catch { /* skip */ }
  }
  return urls;
}
const idDaUrl = url => (String(url).match(/-(\d{4,})(?:[/?#]|$)/) || [])[1] || String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();

function cidadeUF(txt, titulo = '') {
  const fonte = `${titulo} ${txt}`;
  let m = fonte.match(/\b(?:em|de|no|na)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*[\/-]\s*([A-Z]{2})\b/);
  if (!m) m = fonte.match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*[\/-]\s*([A-Z]{2})\b/);
  if (!m) return { cidade: null, estado: null };
  return { cidade: m[1].trim().replace(/\s+/g, ' ').slice(0, 60), estado: (m[2] || '').toUpperCase() || null };
}
const limparTitulo = t => (t || '').replace(/\s*[-–|]\s*(?:Lance Inicial|Avalia[çc][ãa]o|Valor|Emilio Matos|Emílio Matos).*$/i, '').replace(/\s+/g, ' ').trim();

function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const rotLance = plaus(num((txt.match(/lance\s*(?:inicial|m[íi]nimo|atual)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const rotAval = plaus(num((txt.match(/(?:avalia[çc][ãa]o|valor\s+de\s+avalia)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
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
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m[²2]/i) || [])[1]);
  const { cidade, estado } = cidadeUF(txt, base.titulo || '');
  const mat = (txt.match(/matr[íi]cula[^\d]{0,20}([\d.\-\/]{2,})/i) || [])[1] || null;

  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  return {
    titulo: limparTitulo(base.titulo).slice(0, 180) || null,
    cidade, estado, link_foto: base.link_foto,
    valor_avaliacao: avaliacao, valor_minimo: valorMinimo,
    modalidade, area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i), link_matricula: findDoc(/matr[íi]cula/i),
    anexos,
  };
}

function montarRow(url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: FONTE, fonte_id: `emiliomatos_${id}`,
    titulo: det.titulo || `Imóvel ${LEILOEIRO} ${id}`,
    tipo: inferirTipo(det.titulo || '', url),
    modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula, anexos: det.anexos,
    leiloeiro: LEILOEIRO, data_leilao: det.data_leilao || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
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
    if (urls.size === antes) break;   // página sem novidade = fim
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
  const alvo = lotes[0];
  if (alvo) {
    const { html: dh, via: dv } = await fetchEM(alvo);
    if (dh) {
      const det = parseDetalhe(dh, alvo);
      console.log(`── detalhe ${alvo} (via ${dv}, ${dh.length} bytes)`);
      console.log('   parseDetalhe →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
      const t = decodificarEntidades(dh.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
      console.log('   R$ ctx:', JSON.stringify([...t.matchAll(/.{0,40}R\$\s*[\d.]+,\d{2}/g)].map(m => m[0].trim()).slice(0, 8)));
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

  let prontos = [];
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
      const row = montarRow(url, parseDetalhe(html, url));
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { reprov++; continue; }
      prontos.push(row);
      await sleep(350);
    }
    console.log(`${prontos.length} prontos · ${reprov} descartados · ${sem} sem detalhe`);
  }

  // Coleta que não coletou nada não é sucesso — separa "sem cota" (orçamento) de "regressão".
  if (!prontos.length) {
    await registrarSaude(supabase, FONTE, [], 'emiliomatos', {
      ok: false, semCota: SEM_COTA, enumerados: ENUMERADOS,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: SEM_COTA
        ? 'SEM COTA Bright Data — coleta não tentada (orçamento, não regressão da fonte)'
        : 'execução sem nenhum lote pronto',
    });
    console.error(SEM_COTA ? 'sem cota Bright Data — orçamento, não regressão.' : 'nada a gravar. Saindo com erro.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
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
