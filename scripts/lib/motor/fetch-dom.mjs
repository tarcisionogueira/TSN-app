/**
 * MOTOR DE FETCH `dom` (Passo 2 do redesenho fetch × parse) — Chromium headless (Puppeteer)
 * renderiza a página e devolve o HTML PÓS-JS. É o eixo de fetch para fonte SPA sem SSR
 * (alfa: detalhe é shell de 8KB; hasta: todo /lote/ devolve o MESMO shell de 115KB;
 * nordeste: Next App Router com RSC, 0 XHR interceptável — recons de 20/08).
 *
 * Contrato IGUAL ao do criarMotorFetch (fetch-fonte.mjs): `fetchFonte(url) → {html, via}` e
 * `estado` observável — o runner não distingue os motores. Custo: zero de Bright Data (roda
 * no runner do GitHub Actions, mesmas fontes sem Cloudflare); o preço é tempo de render.
 *
 * Falha NUNCA vira conteúdo (formas #4/#5 do CLAUDE.md): erro de navegação devolve
 * {html: null} e o runner trata como "sem detalhe"/fetch falho — jamais como fonte vazia.
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function criarMotorDom({ esperaMs = 2500, timeoutMs = 45000 } = {}) {
  const estado = { semCota: false };   // dom não usa Bright Data; campo existe pelo contrato
  let browser = null;

  async function garantir() {
    if (!browser) browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return browser;
  }

  async function fetchFonte(url) {   // 2º arg (opts do contrato) não se aplica ao dom
    let page = null;
    try {
      page = await (await garantir()).newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1366, height: 900 });
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
      // 4xx/5xx de verdade não é página: não entregar o corpo de erro como conteúdo.
      // E SEMPRE com log — o HASTA falhou mudo no 1º DRY-RUN e o "0 enumerados" não dizia porquê.
      if (resp && resp.status() >= 400) {
        console.error(`   [dom] HTTP ${resp.status()} em ${url}`);
        return { html: null, via: `dom-${resp.status()}` };
      }
      await new Promise(r => setTimeout(r, esperaMs));   // hidratação após network idle
      const html = await page.content();
      return { html: html || null, via: 'dom' };
    } catch (e) {
      console.error(`   [dom] falha em ${url}: ${String(e.message || e).slice(0, 120)}`);
      return { html: null, via: 'dom-falha' };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  async function fechar() {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
  }

  return { fetchFonte, estado, fechar };
}
