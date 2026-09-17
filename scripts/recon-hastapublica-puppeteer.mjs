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
      if (chamadasXhr.length) console.log(`  chamadas XHR/fetch: ${JSON.stringify(chamadasXhr.filter((u) => !/google|doubleclick|jivosite|rdstation|analytics|facebook|socket\.io/i.test(u)).slice(0, 20))}`);
      else console.log('  nenhuma chamada XHR/fetch vista.');
      for (const r of respostas) console.log(`  RESPOSTA ${r.url} (HTTP ${r.status}, ${r.ct}): ${JSON.stringify(r.corpo)}`);
      // Também procura links de leilão na listagem, pra confirmar o padrão de URL.
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/leilao/"]')].map((a) => a.getAttribute('href')).slice(0, 15)
      ).catch(() => []);
      if (links.length) console.log(`  links /leilao/ na página: ${JSON.stringify(links)}`);
      // Texto renderizado de verdade (o que um usuário vê), em vez do HTML — mais fácil achar
      // onde os lotes aparecem e se têm R$/m²/matrícula.
      const texto = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.log(`  TEXTO renderizado (${texto.length} chars): ${JSON.stringify(texto.slice(0, 4000))}`);
      // Script inline com dado embutido (padrão comum: var lotes = [...] ou JSON dentro de <script>)
      const scripts = await page.evaluate(() =>
        [...document.querySelectorAll('script:not([src])')]
          .map((s) => s.textContent)
          .filter((t) => /lote|R\$|valor|matr[íi]cula/i.test(t))
          .slice(0, 3)
      ).catch(() => []);
      scripts.forEach((s, i) => console.log(`  SCRIPT INLINE #${i} (${s.length} chars): ${JSON.stringify(s.slice(0, 3000))}`));
    } catch (e) {
      console.log(`  erro: ${e.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await browser.close();
})();
