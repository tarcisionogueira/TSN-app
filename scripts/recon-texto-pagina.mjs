/**
 * RECON genérico (só leitura): abre cada URL no Chromium e imprime, do innerText, cada trecho
 * que casa com RECON_PADRAO (regex, sem flags; aplicada com 'gi'), com contexto. Nasceu para a
 * #172 (ZUK 37810: a data existe na página e o coletor não lê, ou o site não publicou?).
 * Env: RECON_URLS (vírgula) · RECON_PADRAO · RECON_CONTEXTO (chars, 160)
 */
import puppeteer from 'puppeteer';

const URLS = (process.env.RECON_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const PADRAO = new RegExp(process.env.RECON_PADRAO || '\\d{2}/\\d{2}/\\d{4}', 'gi');
const CTX = Number(process.env.RECON_CONTEXTO || 160);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const url of URLS) {
    console.log(`\n═══ ${url}`);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      const txt = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
      console.log(`  HTTP ${resp?.status()} · ${txt.length} chars · título: ${JSON.stringify(await page.title())}`);
      let n = 0;
      for (const m of txt.matchAll(PADRAO)) {
        if (++n > 25) { console.log('  … (mais de 25 ocorrências)'); break; }
        console.log(`  [${m[0]}] …${txt.slice(Math.max(0, m.index - CTX), m.index + m[0].length + CTX)}…`);
      }
      if (!n) console.log(`  nenhuma ocorrência de ${PADRAO}; início: ${JSON.stringify(txt.slice(0, 600))}`);
    } catch (e) { console.log(`  ERRO: ${String(e.message).slice(0, 160)}`); }
    finally { await page.close().catch(() => {}); }
  }
} finally { await browser.close(); }
