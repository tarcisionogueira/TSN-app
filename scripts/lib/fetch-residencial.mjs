// Fetch RESIDENCIAL via Chromium real (puppeteer) — passa o Cloudflare de um IP RESIDENCIAL,
// SEM Bright Data. Para os scrapers que hoje usam BD por causa do Cloudflare (GESTAO, RJ).
// IMPORTANTE: rodar de CASA — o Cloudflare bloqueia IP de datacenter mesmo com navegador real
// (por isso a CI usa BD). O puppeteer é importado LAZY: quem só usa BD/CI não precisa dele.
let _puppeteer = null;
let _browser = null;

async function browser() {
  if (_browser) return _browser;
  if (!_puppeteer) _puppeteer = (await import('puppeteer')).default;
  _browser = await _puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  });
  return _browser;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = (h) => /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(String(h || '').slice(0, 4000));

/**
 * Busca o HTML FINAL (após o Cloudflare/JS resolver). Retorna string ou null.
 * O navegador real já decodifica o charset (ex.: latin1 do GESTAO) → sem mojibake.
 */
export async function fetchHeadless(url, { timeoutMs = 60000, esperaMs = 4000 } = {}) {
  let page;
  try {
    // Respiro com jitter ANTES de cada requisição: paceia o IP residencial (evita rajada que
    // dispara anti-bot). O cookie do Cloudflare (cf_clearance) persiste no contexto padrão do
    // browser entre páginas → as requisições seguintes quase não são desafiadas.
    await new Promise((r) => setTimeout(r, 600 + Math.floor(Math.random() * 1200)));
    const b = await browser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, esperaMs));         // deixa o desafio/JS resolver
    let html = await page.content();
    if (ehChallenge(html)) {                                    // ainda no desafio → espera mais
      await new Promise((r) => setTimeout(r, 6000));
      html = await page.content();
    }
    if (ehChallenge(html)) { console.error(`  [headless] ${url} → desafio Cloudflare não resolveu`); return null; }
    return html;
  } catch (e) {
    // Erro VISÍVEL (não silencioso): sem isto o 1º run real em WSL mostrou só "home não
    // veio" e escondeu a causa (launch do Chromium? rede? timeout?). Continua devolvendo
    // null — o scraper não trava; mas o log diz o porquê.
    console.error(`  [headless] ${url} → ${String(e?.message || e).slice(0, 200)}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function fecharHeadless() {
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}
