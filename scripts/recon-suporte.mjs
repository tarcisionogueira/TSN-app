/**
 * Recon SUPORTE (white-label /buscador?categoria=2) — GRÁTIS via Puppeteer no runner (a
 * plataforma é server-rendered e não usa Cloudflare/BD, igual leffa). Confirma se casas NOVAS
 * do backlog (leilaobrasil, vecchi, saraiva) rodam a MESMA base e têm imóveis reais — e NÃO são
 * redirect 100% PGFN (comprei.pgfn.gov.br, sem docs). Dumpa contagem + 1 lote parseado por tenant.
 * NÃO grava. Uso: node scripts/recon-suporte.mjs  (SUPORTE_DOMS opcional, csv).
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const DOMS = (process.env.SUPORTE_DOMS || 'leilaobrasil.com.br,vecchileiloes.com.br,saraivaleiloes.com.br')
  .split(',').map(s => s.trim()).filter(Boolean);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

for (const dom of DOMS) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const url = `https://${dom}/buscador?categoria=2`;
  console.log(`\n════ ${dom} ════`);
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
    const finalUrl = page.url();
    console.log(`  HTTP ${resp?.status()} · url final: ${finalUrl}`);
    if (/comprei\.pgfn\.gov\.br/i.test(finalUrl)) { console.log('  ⚠️ REDIRECT p/ PGFN — pular (sem docs).'); await page.close(); continue; }
    const info = await page.evaluate(() => {
      const arts = document.querySelectorAll('article.lote-main, article[class*="lote"], .lote-main');
      const reais = (document.body.innerText.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
      const first = arts[0];
      let amostra = null;
      if (first) {
        const q = (sel) => first.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const a = first.querySelector('a[href*="/lote/"], a[href*="/eventos/"]');
        amostra = {
          cod: q('.strong-cod'), tipo: q('h3'), desc: q('p').slice(0, 80),
          local: q('.r2 span, [class*="r2"] span'), valor: q('.r4 strong, [class*="r4"] strong, strong.reset-colorGrid'),
          href: a?.getAttribute('href') || '', foto: first.querySelector('img.img-evento, img')?.getAttribute('src') || '',
        };
      }
      // Também detecta paginação (nº de páginas → total aproximado).
      const pags = [...document.querySelectorAll('a[href*="page="], .pagination a')].map(a => a.getAttribute('href')).filter(Boolean);
      const maxPage = pags.reduce((mx, h) => { const m = /page=(\d+)/.exec(h); return m ? Math.max(mx, +m[1]) : mx; }, 1);
      return { nArts: arts.length, reais, amostra, maxPage };
    });
    console.log(`  lotes na 1ª pág: ${info.nArts} · R$=${info.reais} · páginas≈${info.maxPage}`);
    console.log('  amostra:', JSON.stringify(info.amostra));
    const ok = info.nArts >= 3 && info.reais >= 3 && info.amostra?.href;
    console.log(`  → ${ok ? '✅ SUPORTE white-label com imóveis (adicionar como tenant)' : '❌ não confirma (vazio/estrutura diferente)'}`);
  } catch (e) { console.log(`  erro: ${String(e.message).slice(0, 120)}`); }
  await page.close();
}
await browser.close();
console.log('\nConfirmados ✅ entram em SUPORTE_TENANTS (scraper-puppeteer.mjs).');
