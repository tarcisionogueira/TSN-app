/**
 * RECON — LJUD, última tentativa: em vez de adivinhar `tipo=`/`categoria=`, visita a
 * página REAL de veículos (https://www.leiloesjudiciais.com.br/veiculos, achada no menu
 * da home pelo recon v3) e INTERCEPTA a requisição que ELA MESMA faz pra API — exatamente
 * o mecanismo que scraperSodreVeiculos já usa pra Sodré. É a forma que não depende de
 * adivinhar nome de parâmetro nenhum: a página conta sozinha qual valor ela usa.
 *
 * Uso: node scripts/recon-ljud-intercept.mjs
 */
import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const chamadas = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/api\.leiloesjudiciais\.com\.br\/core\/api\//.test(url)) {
      chamadas.push({ url, method: req.method(), body: req.postData() || null });
    }
  });
  try {
    await page.setUserAgent('Mozilla/5.0');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/veiculos', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`\n════ Chamadas de API interceptadas em /veiculos (${chamadas.length}) ════`);
    for (const c of chamadas) {
      console.log(`  ${c.method} ${c.url}`);
      if (c.body) console.log(`    body: ${c.body.slice(0, 300)}`);
    }
    if (!chamadas.length) {
      console.log('  Nenhuma chamada à API core interceptada — a página pode não ter itens, ou usar outro domínio de API.');
      const titulo = await page.title();
      const textoBreve = (await page.evaluate(() => document.body.innerText || '')).slice(0, 400);
      console.log(`  título da página: ${titulo}`);
      console.log(`  início do texto da página: ${textoBreve}`);
    }
  } catch (e) {
    console.error('Recon falhou:', e?.message || e);
  } finally {
    await browser.close();
  }
  console.log('\n✅ Recon concluído.');
}

main();
