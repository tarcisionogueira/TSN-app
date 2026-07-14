/**
 * Recon dos leiloeiros NOVOS (Pecini, WebLeilões) — descobre a estrutura antes de
 * escrever o scraper (método recon-first). NÃO grava nada: só explora e reporta.
 *
 * Para cada site: abre a home, procura a seção de IMÓVEIS, intercepta as chamadas
 * XHR/fetch (APIs JSON internas — a via mais robusta), e imprime no log:
 *   - endpoints JSON chamados (URL + amostra do corpo)
 *   - candidatos a card de lote no DOM (seletores + amostra de texto)
 *   - paginação detectada
 * Roda no GitHub Actions (egress liberado). Config por env RECON_SITES (csv).
 */
import puppeteer from 'puppeteer';

const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SITES = {
  PECINI: {
    base: 'https://www.pecinileiloes.com.br',
    // caminhos comuns de listagem de imóveis em plataformas de leilão
    paths: ['/', '/imoveis', '/lotes/imoveis', '/busca?categoria=imoveis', '/categoria/imoveis', '/leiloes'],
  },
  WEBLEILOES: {
    base: 'https://www.webleiloes.com.br',
    paths: ['/', '/imoveis', '/lotes/imoveis', '/busca?categoria=imoveis', '/categoria/imoveis', '/leiloes'],
  },
};

const alvo = String(process.env.RECON_SITES || 'PECINI,WEBLEILOES').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);

function ehJsonInteressante(url, ct) {
  if (/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|css|js)(\?|$)/i.test(url)) return false;
  if (/json/i.test(ct || '')) return true;
  return /\/api\/|\/v\d\/|graphql|busca|lote|imove|leilao|search|catalog/i.test(url);
}

async function reconSite(browser, nome, cfg) {
  console.log(`\n\n══════════════════ RECON ${nome} (${cfg.base}) ══════════════════`);
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });

  const apis = new Map(); // url -> {status, ct, sample}
  page.on('response', async (resp) => {
    try {
      const url = resp.url(); const ct = resp.headers()['content-type'] || '';
      if (!ehJsonInteressante(url, ct)) return;
      if (apis.has(url)) return;
      let sample = '';
      try { sample = (await resp.text()).slice(0, 500).replace(/\s+/g, ' '); } catch { /* corpo consumido */ }
      apis.set(url, { status: resp.status(), ct, sample });
    } catch { /* ignora */ }
  });

  for (const path of cfg.paths) {
    const url = cfg.base + path;
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      const status = resp ? resp.status() : '?';
      // dá tempo de disparar XHRs de listagem
      await new Promise(r => setTimeout(r, 3500));
      // tenta rolar para carregar lazy/paginação infinita
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const info = await page.evaluate(() => {
        const pick = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 3).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90));
        // heurística de cards de lote
        const cardSels = ['.card', '.lote', '.item-lote', '[class*="lote"]', '[class*="card"]', 'article', '.product', '[class*="imovel"]'];
        const cards = {};
        for (const s of cardSels) { const n = document.querySelectorAll(s).length; if (n) cards[s] = n; }
        // links que parecem de lote/imóvel
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.getAttribute('href'))
          .filter(h => h && /lote|imove|leilao|bem|detalhe|sale/i.test(h))
          .slice(0, 12);
        // paginação
        const pag = Array.from(document.querySelectorAll('[class*="pag"], .pagination, nav a')).slice(0, 6).map(e => (e.textContent || '').trim().slice(0, 20)).filter(Boolean);
        return { titulo: document.title, cardCounts: cards, sampleCards: pick('[class*="lote"], .card, article'), loteLinks: [...new Set(links)], paginacao: pag };
      });

      console.log(`\n── ${url}  → HTTP ${status}`);
      console.log(`   título: ${info.titulo}`);
      console.log(`   contagem de cards por seletor: ${JSON.stringify(info.cardCounts)}`);
      if (info.sampleCards?.length) console.log(`   amostra de cards: ${JSON.stringify(info.sampleCards)}`);
      if (info.loteLinks?.length) console.log(`   links de lote/imóvel: ${JSON.stringify(info.loteLinks)}`);
      if (info.paginacao?.length) console.log(`   paginação: ${JSON.stringify(info.paginacao)}`);
    } catch (e) {
      console.log(`\n── ${url}  → ERRO: ${String(e.message).slice(0, 120)}`);
    }
  }

  console.log(`\n   ▓▓ APIs JSON interceptadas (${apis.size}):`);
  for (const [url, d] of apis) {
    console.log(`   • [${d.status}] ${url}`);
    if (d.sample) console.log(`       corpo: ${d.sample}`);
  }
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS });
  try {
    for (const nome of alvo) {
      const cfg = SITES[nome];
      if (!cfg) { console.log(`Site desconhecido: ${nome}`); continue; }
      try { await reconSite(browser, nome, cfg); }
      catch (e) { console.log(`Recon ${nome} falhou: ${e.message}`); }
    }
  } finally {
    await browser.close();
  }
  console.log('\n\n✅ Recon concluído — use o output para construir scraperPecini/scraperWebLeiloes.');
})();
