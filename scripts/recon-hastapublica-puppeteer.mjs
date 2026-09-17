#!/usr/bin/env node
/**
 * RECON — hastapublica.com.br via Puppeteer real. O HTML estático da página de leilão
 * (`/leilao/painel/{id}`) tem um `<div class="modal" id="modalLote">...Modal body..</div>` —
 * placeholder clássico de conteúdo carregado por AJAX ao clicar num lote, a mesma assinatura
 * que enganou o recon estático de joserodovalho/hdleiloes (18/09). Executa o JS de verdade e
 * grampeia toda chamada XHR/fetch pra achar o endpoint real de lotes antes de escrever parser.
 * Grátis (mesmo caminho do LJUD/MEGA), roda no GitHub Actions.
 */
import puppeteer from 'puppeteer';

const URL_LEILAO = 'https://hastapublica.com.br/leilao/painel/18182';
const URL_LISTAGEM = 'https://hastapublica.com.br/leiloes';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });

  for (const url of [URL_LISTAGEM, URL_LEILAO]) {
    console.log(`\n=== ${url} ===`);
    const page = await browser.newPage();
    const chamadasXhr = [];
    const respostas = [];
    page.on('request', (req) => {
      const t = req.resourceType();
      if (t === 'xhr' || t === 'fetch') chamadasXhr.push(req.url());
    });
    page.on('response', async (res) => {
      const u = res.url();
      const ct = res.headers()['content-type'] || '';
      if (/\/(lote|ajax|api)/i.test(u) && (ct.includes('json') || ct.includes('html'))) {
        try {
          const txt = await res.text();
          respostas.push({ url: u, status: res.status(), ct, corpo: txt.slice(0, 3000) });
        } catch { /* padrao-ok: corpo pode ja ter sido consumido pelo browser — best-effort, so recon */ }
      }
    });
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`  goto: status=${resp?.status() ?? '(sem response)'}`);
      // Tenta clicar num lote pra disparar o AJAX do modal, se a listagem existir na página.
      const clicou = await page.evaluate(() => {
        const alvo = document.querySelector('[onclick*="Lote"], [data-lote], a[href*="/lote/"]');
        if (alvo) { alvo.click(); return alvo.outerHTML.slice(0, 200); }
        return null;
      }).catch(() => null);
      if (clicou) console.log(`  clicou em: ${clicou}`);
      await new Promise((r) => setTimeout(r, 3000));
      const html = await page.content();
      console.log(`  HTML renderizado: ${html.length} bytes`);
      if (chamadasXhr.length) console.log(`  chamadas XHR/fetch: ${JSON.stringify(chamadasXhr.slice(0, 20))}`);
      else console.log('  nenhuma chamada XHR/fetch vista.');
      for (const r of respostas) console.log(`  RESPOSTA ${r.url} (HTTP ${r.status}, ${r.ct}): ${JSON.stringify(r.corpo)}`);
      // Também procura links de leilão na listagem, pra confirmar o padrão de URL.
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/leilao/"]')].map((a) => a.getAttribute('href')).slice(0, 15)
      ).catch(() => []);
      if (links.length) console.log(`  links /leilao/ na página: ${JSON.stringify(links)}`);
    } catch (e) {
      console.log(`  erro: ${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await browser.close();
})();
