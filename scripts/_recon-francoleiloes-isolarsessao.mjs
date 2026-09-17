// TEMPORÁRIO — confirma se o 403/challenge da página de DETALHE do FRANCOLEILOES (achado no
// recon anterior, mesma sessão que a HOME já tinha passado limpo) é rate-limit POR SESSÃO —
// mesma assinatura já resolvida em JELEILOES (07/09) e ALBERTOMACEDOLEILOES (17/09) — ou
// bloqueio de verdade. Home já confirmou: 32 sinais de R$, 48 links reais de lote
// (/lote/<leilao>/<id>/). Este recon abre a MESMA URL de detalhe, mas em CONTEXTO ISOLADO
// (BrowserContext incógnito novo), sem nenhuma navegação anterior na mesma sessão.
import puppeteer from 'puppeteer';

const URL_LOTE = process.env.LOTE_URL || 'https://www.francoleiloes.com.br/lote/leilao-banco-inter/9728/';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log(`🔎 RECON isolarSessao — FRANCOLEILOES detalhe: ${URL_LOTE}\n`);
  let status = null;
  try {
    const resp = await page.goto(URL_LOTE, { waitUntil: 'networkidle2', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) {
    console.log(`erro ao navegar: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 4000));
  const html = await page.content();
  const texto = await page.evaluate(() => document.body.innerText).catch(() => '');
  const challenge = /just a moment|performing security verification|checking your browser|cf-browser-verification/i.test(html);

  console.log(`status: ${status} · html: ${html.length} chars · texto visível: ${texto.length} chars`);
  console.log(`ainda em challenge Cloudflare? ${challenge}`);
  if (!challenge) {
    const rs = (texto.match(/R\$\s?[\d.,]+/g) || []).length;
    console.log(`sinais de R$: ${rs}`);
    console.log(`trecho (1200 chars): "${texto.replace(/\s+/g, ' ').trim().slice(0, 1200)}"`);
    const pdfs = [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]);
    console.log(`PDFs no HTML: ${pdfs.length}`);
    for (const p of pdfs.slice(0, 5)) console.log(`  ${p}`);
  } else {
    console.log(`trecho do challenge (400 chars): "${texto.replace(/\s+/g, ' ').trim().slice(0, 400)}"`);
  }

  console.log('\n═══ FIM DO RECON');
  await browser.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
