/**
 * RECON DA DATA DO FERREIRALEIL — rodar UMA VEZ do computador de CASA (IP residencial).
 *   node scripts/recon-ferreira-data.mjs
 *
 * Por que existe (06/10): 176 de 180 lotes FERREIRALEIL ativos estão sem data — sem data, o gate de
 * leilão encerrado falha aberto. O recon de 20/09 (HANDOFF, sessão 26) esgotou o que a CI alcança:
 * datacenter toma desafio Cloudflare e o Bright Data traz a página COMPLETA mas sem nenhuma data no
 * texto. Hipótese em aberto: a data é montada por JavaScript. Só um navegador real de IP residencial
 * separa "o site parou de publicar" de "está no JS".
 *
 * O que faz: pega 3 lotes ativos sem data, abre cada um (1) por fetch puro e (2) no Chromium, e
 * registra as datas dd/mm/aaaa encontradas em cada via, mais o trecho ao redor. NÃO grava no acervo:
 * o resultado vai para `recon_dump` (origem 'recon_ferreira_data'), onde a sessão do Claude lê.
 * Env: ~/.bidpro-runner.env (VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY) — mesmo do runner.
 */
import './lib/env-runner.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
const hdr = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const RE_DATA = /\b\d{2}\/\d{2}\/\d{4}(?:\s*(?:às|as|-)?\s*\d{1,2}[:h]\d{2})?/gi;

function datasDe(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const out = [];
  for (const m of t.matchAll(RE_DATA)) {
    out.push({ data: m[0], contexto: t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20) });
    if (out.length >= 8) break;
  }
  return out;
}

const r = await fetch(`${SB_URL}/rest/v1/imoveis_leilao?fonte=eq.FERREIRALEIL&ativo=eq.true&data_leilao=is.null&data_leilao_2=is.null&url_lote=not.is.null&select=fonte_id,url_lote&limit=3`, { headers: hdr });
if (!r.ok) { console.error('não consegui ler os lotes:', r.status, await r.text()); process.exit(1); }
const lotes = await r.json();
console.log(`${lotes.length} lote(s) FERREIRALEIL sem data`);

const puppeteer = (await import('puppeteer')).default;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const resultado = [];
try {
  for (const l of lotes) {
    const item = { fonte_id: l.fonte_id, url: l.url_lote };
    try {
      const f = await fetch(l.url_lote, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(20000) });
      const html = await f.text();
      item.fetch = { status: f.status, bytes: html.length, cloudflare: /just a moment|cf-chl/i.test(html), datas: datasDe(html.replace(/<[^>]+>/g, ' ')) };
    } catch (e) { item.fetch = { erro: String(e?.message || e).slice(0, 120) }; }
    const page = await browser.newPage();
    try {
      await page.setUserAgent(UA);
      const resp = await page.goto(l.url_lote, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((res) => setTimeout(res, 4000)); // widgets tardios
      const txt = await page.evaluate(() => document.body?.innerText || '');
      // Links para a página do LEILÃO (a data pode morar lá, não no item).
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /leil[aã]o|evento|pra[cç]a/i.test(h)).slice(0, 5));
      item.chromium = { status: resp?.status() ?? null, chars: txt.length, cloudflare: /just a moment|verifique se voc[eê] [eé] humano/i.test(txt), datas: datasDe(txt), links_leilao: links };
    } catch (e) { item.chromium = { erro: String(e?.message || e).slice(0, 120) }; }
    finally { await page.close().catch(() => {}); }
    console.log(JSON.stringify(item, null, 1));
    resultado.push(item);
  }
} finally { await browser.close().catch(() => {}); }

const w = await fetch(`${SB_URL}/rest/v1/recon_dump`, { method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' },
  body: JSON.stringify({ origem: 'recon_ferreira_data', chave: new Date().toISOString(), conteudo: resultado }) });
console.log(w.ok ? '✅ resultado gravado em recon_dump (origem recon_ferreira_data)' : `⚠️ não gravou em recon_dump (HTTP ${w.status}) — copie o JSON acima`);
