#!/usr/bin/env node
/**
 * RECON DESCARTÁVEL (20/09) — por que data_leilao continua 0-2% em GESTAOLEILOES/PECINI/
 * FERREIRALEIL mesmo com fetchResidencial já importado (GESTAO/PECINI) e cota do Bright Data
 * disponível (`gestao`/`pecini`/`soleon` todos com folga esta semana)?
 *
 * O diagnóstico de 13/09 (`diagnostico-datas-fontes.mjs`) mediu a página ERRADA para o GESTAO:
 * fez fetch direto de `lote.php?idLote=` (9/9 → 403), mas a produção (`scraper-gestao.mjs
 * coletarEvento()`) tira a data de `leilao.php?idLeilao=` via `bd()` — que em CI usa
 * `buscarViaBrightData` (pago, IP não-datacenter), NÃO fetch direto. Ou seja: o 403 medido não é
 * necessariamente o que trava a produção. Este script mede o caminho REAL de cada fonte:
 *  - GESTAOLEILOES: leilao.php?idLeilao=N (o `link_edital` real de lotes sem data) via fetch
 *    direto E via Bright Data; roda o MESMO regex de `dataEvento()` do scraper-gestao.mjs.
 *  - PECINI: url_lote via fetch direto E via Bright Data; roda `extrairData()` (scraper-core).
 *  - FERREIRALEIL: url_lote (item/N/detalhes) via fetch direto (replica `fetchTenant()` do
 *    scraper-soleon.mjs) E via Bright Data; roda `extrairData()`.
 * Não grava nada. Gasto: até ~12 requisições Bright Data no total (orçamento com folga).
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
import { extrairData } from './lib/scraper-core.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';
import { decodificarEntidades } from '../api/_texto-imovel.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`);
  return r.json();
}

const MESES = { jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06', jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12' };
function dataEventoGestao(txt) {
  const mAbrev = txt.match(/(\d{1,2})\/([A-Za-zç]{3})\/(\d{4})/);
  if (mAbrev) {
    const mm = MESES[mAbrev[2].toLowerCase().slice(0, 3)];
    if (mm) return `${mAbrev[3]}-${mm}-${mAbrev[1].padStart(2, '0')}`;
  }
  const dmy = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
}

async function fetchDireto(url, { timeoutMs = 20000 } = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { html: null, via: `http_${r.status}` };
    const html = await r.text();
    return { html, via: 'direto' };
  } catch (e) { return { html: null, via: `erro_${String(e?.name || e).slice(0, 30)}` }; }
}

async function fetchBD(url, proposito, { charset = 'utf-8' } = {}) {
  try {
    const r = await buscarViaBrightData(url, { proposito, timeoutMs: 60000, exigirOk: false });
    if (!r || !r.ok) return { html: null, via: `bd_bloqueado_${r ? r.status : '?'}` };
    const buf = await r.arrayBuffer();
    const html = new TextDecoder(charset).decode(buf);
    return { html, via: 'brightdata' };
  } catch (e) {
    if (e instanceof ErroBrightData) return { html: null, via: e.semCota ? 'bd_sem_cota' : `bd_erro_${e.motivo}` };
    return { html: null, via: `bd_excecao_${String(e?.message || e).slice(0, 60)}` };
  }
}

function achadosCrus(html, n = 6) {
  const texto = decodificarEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const re = /(\d{1,2})\/([A-Za-zç]{3}|\d{2})\/(\d{4})/g;
  const out = [];
  let m;
  while ((m = re.exec(texto)) && out.length < n) {
    const antes = texto.slice(Math.max(0, m.index - 50), m.index).trim().slice(-45);
    out.push(`"${antes}" → ${m[0]}`);
  }
  return out;
}

async function checarUrl(label, url, { proposito, charset = 'utf-8', usarDataEventoGestao = false } = {}) {
  let { html, via } = await fetchDireto(url);
  if (!html) {
    console.log(`  [${label}] direto=${via} → tentando Bright Data...`);
    ({ html, via } = await fetchBD(url, proposito, { charset }));
  }
  if (!html) { console.log(`  [${label}] ${url} → SEM HTML (${via})`); return; }
  const cabecalho = decodificarEntidades(html.slice(0, 8000).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const viaExtrairData = extrairData(html);
  const viaEventoGestao = usarDataEventoGestao ? dataEventoGestao(cabecalho) : null;
  console.log(`  [${label}] ${url}`);
  console.log(`     via=${via} bytes=${html.length}`);
  console.log(`     extrairData()=${viaExtrairData || '-'}${usarDataEventoGestao ? ` dataEvento()=${viaEventoGestao || '-'}` : ''}`);
  console.log(`     datas cruas: ${achadosCrus(html).join(' | ') || '(NENHUMA no HTML — JS ou sem data publicada)'}`);
}

async function main() {
  console.log('\n===== GESTAOLEILOES — leilao.php?idLeilao= (caminho REAL de produção) =====');
  const gestaoLotes = await sbGet(`imoveis_leilao?select=link_edital&ativo=eq.true&fonte=eq.GESTAOLEILOES&data_leilao=is.null&limit=60`);
  const idsLeilao = [...new Set(gestaoLotes.map(l => l.link_edital).filter(Boolean))].slice(0, 4);
  for (const url of idsLeilao) {
    await checarUrl('GESTAOLEILOES evento', url, { proposito: 'gestao', charset: 'windows-1252', usarDataEventoGestao: true });
    await sleep(500);
  }

  console.log('\n===== PECINI — url_lote =====');
  const pecini = await sbGet(`imoveis_leilao?select=url_lote&ativo=eq.true&fonte=eq.PECINI&data_leilao=is.null&limit=5`);
  for (const l of pecini) {
    await checarUrl('PECINI', l.url_lote, { proposito: 'pecini' });
    await sleep(500);
  }

  console.log('\n===== FERREIRALEIL — url_lote (item/N/detalhes) =====');
  const ferreira = await sbGet(`imoveis_leilao?select=url_lote&ativo=eq.true&fonte=eq.FERREIRALEIL&data_leilao=is.null&limit=5`);
  for (const l of ferreira) {
    await checarUrl('FERREIRALEIL', l.url_lote, { proposito: 'soleon' });
    await sleep(500);
  }
}

main().catch(e => { console.error('[recon-datas-gestao-pecini-ferreiraleil] FALHOU:', e?.message || e); process.exit(1); });
