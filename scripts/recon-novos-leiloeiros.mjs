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
  RJLEILOES: {
    base: 'https://www.rjleiloes.com.br',
    paths: ['/', '/imoveis', '/lotes/imoveis', '/busca?categoria=imoveis', '/categoria/imoveis', '/leiloes', '/lotes', '/imovel', '/pesquisa?tipo=imovel'],
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

      // Dump do 1º card (article) que tem link de /oferta/ — estrutura exata p/ o scraper.
      if (status === 200 && /imoveis|leiloes|busca/.test(path)) {
        const cardHtml = await page.evaluate(() => {
          const arts = Array.from(document.querySelectorAll('article, [class*="card"], li'));
          const alvo = arts.find(a => a.querySelector('a[href*="/oferta/"]'));
          return alvo ? alvo.outerHTML.replace(/\s+/g, ' ').slice(0, 2200) : null;
        }).catch(() => null);
        if (cardHtml) console.log(`   ▸ CARD outerHTML: ${cardHtml}`);
      }
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

// Recon via Bright Data Web Unlocker — para sites atrás de Cloudflare (Pecini), que
// respondem 403 ao Puppeteer. Precisa de BRIGHTDATA_API_TOKEN/ZONE no ambiente.
async function reconViaBrightData(nome, cfg) {
  const TOKEN = process.env.BRIGHTDATA_API_TOKEN, ZONE = process.env.BRIGHTDATA_ZONE;
  console.log(`\n\n══════════════════ RECON ${nome} via Bright Data (${cfg.base}) ══════════════════`);
  if (!TOKEN || !ZONE) { console.log('   ⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes — pulei o unlocker.'); return; }
  for (const path of cfg.paths) {
    const url = cfg.base + path;
    try {
      const r = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(60000),
      });
      const html = await r.text().catch(() => '');
      const titulo = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const ofertas = [...new Set((html.match(/\/(oferta|lote|imovel|leilao)[^"'\s)]+/gi) || []))].slice(0, 12);
      const cloudflare = /just a moment|challenge-platform|cf-chl/i.test(html);
      console.log(`\n── ${url}  → HTTP ${r.status} ${cloudflare ? '(ainda Cloudflare)' : ''}`);
      console.log(`   título: ${titulo}`);
      console.log(`   len=${html.length}  links: ${JSON.stringify(ofertas)}`);
      // 1º bloco que parece card (contém link de lote)
      const m = html.match(/<(article|div|li)[^>]*>(?:(?!<\1)[\s\S]){0,1800}?\/(?:oferta|lote|imovel)[\s\S]{0,1200}?<\/\1>/i);
      if (m) console.log(`   ▸ CARD: ${m[0].replace(/\s+/g, ' ').slice(0, 2000)}`);
    } catch (e) {
      console.log(`\n── ${url}  → ERRO BD: ${String(e.message).slice(0, 120)}`);
    }
  }
}

// Busca crua via Bright Data unlocker (retorna {status, html}).
async function bdFetch(url) {
  const TOKEN = process.env.BRIGHTDATA_API_TOKEN, ZONE = process.env.BRIGHTDATA_ZONE;
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(70000),
  });
  return { status: r.status, html: await r.text().catch(() => '') };
}

// Recon PROFUNDO do Pecini: enumeração via sitemap (sem JS), JSON embutido (Next/Nuxt),
// refs de API e o dump de UMA página de lote (estrutura para o scraper de detalhe).
async function reconPeciniProfundo(cfg) {
  const TOKEN = process.env.BRIGHTDATA_API_TOKEN, ZONE = process.env.BRIGHTDATA_ZONE;
  console.log(`\n\n══════════════════ RECON PECINI PROFUNDO ══════════════════`);
  if (!TOKEN || !ZONE) { console.log('   ⚠️ BRIGHTDATA_* ausentes — pulei.'); return; }

  // 1) Sitemaps — a via mais robusta p/ enumerar TODOS os lotes sem executar JS.
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-lotes.xml', '/robots.txt']) {
    try {
      const { status, html } = await bdFetch(cfg.base + sm);
      const locs = [...new Set((html.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map(x => x.replace(/<\/?loc>/gi, '').trim()))];
      const subs = locs.filter(u => /sitemap/i.test(u));
      const lotes = locs.filter(u => /\/lote\//i.test(u));
      const smRefs = sm === '/robots.txt' ? [...new Set((html.match(/Sitemap:\s*(\S+)/gi) || []))] : [];
      const pareceGzip = /\x1f\x8b/.test(html.slice(0, 4)) || /�/.test(html.slice(0, 40));
      console.log(`\n── ${sm} → HTTP ${status}, len ${html.length}${pareceGzip ? ' (parece GZIP/binário)' : ''}`);
      if (smRefs.length) console.log(`   robots Sitemap: ${JSON.stringify(smRefs)}`);
      console.log(`   ${locs.length} <loc>; sub-sitemaps: ${JSON.stringify(subs.slice(0, 10))}`);
      if (lotes.length) console.log(`   lotes (${lotes.length}) amostra: ${JSON.stringify(lotes.slice(0, 6))}`);
      // Dump cru do começo p/ ver a estrutura real (índice? urlset? html? gzip?).
      if (sm !== '/robots.txt') console.log(`   raw[0..600]: ${html.slice(0, 600).replace(/\s+/g, ' ')}`);
      else console.log(`   robots.txt: ${html.replace(/\s+/g, ' ').slice(0, 500)}`);
    } catch (e) { console.log(`── ${sm} → ERRO: ${String(e.message).slice(0, 100)}`); }
  }

  // 1b) Página de LISTAGEM — descobrir o endpoint AJAX que carrega a grade de lotes
  // (a listagem vem por XHR; no HTML cru achamos a URL do endpoint nos <script>).
  try {
    const { status, html } = await bdFetch(cfg.base + '/busca?categoria=imoveis');
    const scriptSrcs = [...new Set((html.match(/<script[^>]+src=["']([^"']+)["']/gi) || []).map(s => (s.match(/src=["']([^"']+)/i) || [])[1]))].filter(u => /pecini|\/js\/|catalog|busca|lote|produto/i.test(u)).slice(0, 12);
    const endpoints = [...new Set((html.match(/["'`](\/(?:[a-z0-9\-]+\/)*(?:busca|search|catalog|produtos?|lotes?|resultado|filtro|ajax|api)[^"'`\s]*)["'`]/gi) || []).map(s => s.replace(/["'`]/g, '')))].slice(0, 20);
    const formAction = [...new Set((html.match(/<form[^>]+action=["']([^"']+)["']/gi) || []).map(s => (s.match(/action=["']([^"']+)/i) || [])[1]))].slice(0, 6);
    console.log(`\n── LISTAGEM /busca?categoria=imoveis → HTTP ${status}, len ${html.length}`);
    console.log(`   <script src> (relevantes): ${JSON.stringify(scriptSrcs)}`);
    console.log(`   possíveis endpoints: ${JSON.stringify(endpoints)}`);
    console.log(`   form actions: ${JSON.stringify(formAction)}`);
    // trechos de JS que montam a chamada da grade (fetch/ajax/url:)
    const ajaxHints = [...new Set((html.match(/(?:url|action|fetch|\.get|\.post|\.load)\s*[:(]\s*["'`][^"'`]{4,80}["'`]/gi) || []))].filter(s => /busca|lote|catalog|produt|result|filtr|ajax|api/i.test(s)).slice(0, 12);
    console.log(`   pistas de AJAX: ${JSON.stringify(ajaxHints)}`);
  } catch (e) { console.log(`── LISTAGEM → ERRO: ${String(e.message).slice(0, 100)}`); }

  // 2) Home: JSON embutido + refs de API + links de lote.
  let loteUrls = [];
  try {
    const { html: home } = await bdFetch(cfg.base + '/');
    const nd = (home.match(/id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i) || [])[1];
    const nuxt = /window\.__NUXT__/.test(home);
    const apiRefs = [...new Set((home.match(/["'`](https?:\/\/[^"'`\s]*\/(?:api|v\d|graphql)\/[^"'`\s]*|\/(?:api|v\d|graphql)\/[^"'`\s]*)["'`]/gi) || []).map(s => s.replace(/["'`]/g, '')))].slice(0, 15);
    loteUrls = [...new Set((home.match(/\/lote\/[^"'\s)]+/gi) || []))];
    console.log(`\n── HOME: __NEXT_DATA__=${!!nd}${nd ? ` (len ${nd.length})` : ''}  __NUXT__=${nuxt}`);
    console.log(`   refs de API: ${JSON.stringify(apiRefs)}`);
    console.log(`   lotes na home (${loteUrls.length}): ${JSON.stringify(loteUrls.slice(0, 8))}`);
    if (nd) console.log(`   __NEXT_DATA__ (3000): ${nd.replace(/\s+/g, ' ').slice(0, 3000)}`);
  } catch (e) { console.log(`── HOME → ERRO: ${String(e.message).slice(0, 100)}`); }

  // 3) Dump de UMA página de lote — estrutura de detalhe (preço, avaliação, praças, foto, cidade/UF).
  const alvoLote = loteUrls[0] || '/lote/recife-pe/10474/';
  try {
    const { status, html } = await bdFetch(cfg.base + alvoLote);
    console.log(`\n── LOTE ${alvoLote} → HTTP ${status}, len ${html.length}`);
    const nd = (html.match(/id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i) || [])[1];
    const ldjson = [...(html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [])].map(s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 800));
    const valores = [...new Set((html.match(/R\$\s?[\d.\s]+,\d{2}/g) || []))].slice(0, 12);
    const marcadores = [...new Set((html.match(/(avalia\w*|1[ªa]?\s*pra\w*|2[ªa]?\s*pra\w*|lance\s*(?:inicial|m[íi]nimo)|venda\s*direta|edital|matr[íi]cula|\d+[.,]?\d*\s*m²)/gi) || []))].slice(0, 18);
    const ogimg = [...new Set((html.match(/<meta[^>]+og:image[^>]+content=["']([^"']+)["']/gi) || []).map(s => (s.match(/content=["']([^"']+)/i) || [])[1]))].slice(0, 4);
    const fotos = [...new Set((html.match(/https?:\/\/[^"'\s]+\.(?:jpe?g|png|webp)/gi) || []))].slice(0, 6);
    console.log(`   valores R$: ${JSON.stringify(valores)}`);
    console.log(`   marcadores: ${JSON.stringify(marcadores)}`);
    console.log(`   og:image: ${JSON.stringify(ogimg)}`);
    console.log(`   fotos: ${JSON.stringify(fotos)}`);
    if (ldjson.length) console.log(`   ld+json: ${JSON.stringify(ldjson)}`);
    if (nd) console.log(`   __NEXT_DATA__ do lote (5000): ${nd.replace(/\s+/g, ' ').slice(0, 5000)}`);
    // Bloco <script> que contém o objeto de dados do lote (campos tipo AvaliacaoDateReferencia).
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    const dataScript = scripts.find(s => /Avaliacao|LanceMinimo|LanceInicial|DataAbertura|IdLeilao/i.test(s));
    if (dataScript) console.log(`   ▸ SCRIPT c/ dados do lote (4000): ${dataScript.replace(/<\/?script[^>]*>/gi, '').replace(/\s+/g, ' ').slice(0, 4000)}`);
    // Rótulos-chave com o valor logo à frente (Avaliação / Lance / desconto / datas).
    const rotulos = [...(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').matchAll(/(Avalia\w*|Lance\s*(?:M[íi]nimo|Inicial)|[\d.,]+\s*%\s*de\s*desconto|Abertura|Fechamento)\s*:?\s*([R$\d.,%\/\sh-]{0,40})/gi))].slice(0, 14).map(m => `${m[1].trim()} = ${m[2].trim()}`);
    console.log(`   rótulos→valor: ${JSON.stringify(rotulos)}`);
    {
      const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
      console.log(`   texto[0..400]: ${txt}`);
    }
  } catch (e) { console.log(`── LOTE ${alvoLote} → ERRO: ${String(e.message).slice(0, 100)}`); }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS });
  try {
    for (const nome of alvo) {
      const cfg = SITES[nome];
      if (!cfg) { console.log(`Site desconhecido: ${nome}`); continue; }
      try { await reconSite(browser, nome, cfg); }
      catch (e) { console.log(`Recon ${nome} (puppeteer) falhou: ${e.message}`); }
      // Pecini responde 403 (Cloudflare) ao Puppeteer → tenta pelo Bright Data unlocker.
      if (nome === 'PECINI') {
        try { await reconViaBrightData(nome, cfg); } catch (e) { console.log(`Recon ${nome} (BD) falhou: ${e.message}`); }
        try { await reconPeciniProfundo(cfg); } catch (e) { console.log(`Recon ${nome} PROFUNDO falhou: ${e.message}`); }
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\n\n✅ Recon concluído — use o output para construir scraperPecini/scraperWebLeiloes.');
})();
