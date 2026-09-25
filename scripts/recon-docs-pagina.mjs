/**
 * RECON (só leitura) — lista TODOS os links de documento de uma página de lote, renderizada no
 * Chromium (25/09: ZUK Z37342 mostrava só o edital no sistema; o dono vê mais documentos na
 * página). Imprime texto do link, href, se é PDF, e o texto em volta da seção "Documentos".
 * Env: RECON_URLS (vírgula).
 */
import puppeteer from 'puppeteer';

const URLS = String(process.env.RECON_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const url of URLS) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    const r = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => ({ status: () => `erro ${e.message}` }));
    console.log(`\n=== ${url} · HTTP ${r?.status?.()}`);
    const info = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href], button[data-href], [onclick]')].map(el => ({
        t: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        h: el.href || el.getAttribute('data-href') || (el.getAttribute('onclick') || '').slice(0, 120),
      })).filter(l => /pdf|documenta|edital|matr[ií]cula|laudo|certid|processo|anexo|download/i.test(`${l.t} ${l.h}`));
      const corpo = document.body.innerText.replace(/\s+/g, ' ');
      const i = corpo.search(/documentos?\b/i);
      const lotes = (corpo.match(/\blote\s*\d+/gi) || []).slice(0, 20);
      return { links, secao: i >= 0 ? corpo.slice(i, i + 900) : '(sem seção Documentos)', lotes };
    });
    console.log('LOTES citados:', JSON.stringify(info.lotes));
    for (const l of info.links) console.log(`  · "${l.t}" → ${l.h}`);
    console.log('SEÇÃO:', info.secao);
    await page.close();
  }
} finally { await browser.close(); }
