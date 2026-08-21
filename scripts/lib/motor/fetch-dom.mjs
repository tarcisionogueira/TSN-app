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

  async function navegar(url) {
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
        return { html: null, via: `dom-${resp.status()}`, definitivo: true };
      }
      await new Promise(r => setTimeout(r, esperaMs));   // hidratação após network idle
      const html = await page.content();
      return { html: html || null, via: 'dom' };
    } catch (e) {
      const msg = String(e.message || e);
      console.error(`   [dom] falha em ${url}: ${msg.slice(0, 120)}`);
      // Chromium morto (Target closed/Protocol error) não se recupera na mesma instância:
      // derruba a referência para o retry relançar o navegador do zero.
      if (/Target closed|Protocol error|disconnected/i.test(msg)) {
        await browser?.close().catch(() => {}); browser = null;
      }
      return { html: null, via: 'dom-falha' };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  // UM retry para falha transitória (timeout de navegação, navegador caído). Sem isso, um
  // único timeout no meio da paginação encerrava a enumeração inteira: no DRY-RUN de 21/08
  // do HASTA, a página 10 estourou 45s e a listagem parou em 270 dos ~579 lotes. HTTP ≥400
  // é resposta DEFINITIVA (não transitória) e não é retentado.
  async function fetchFonte(url) {   // 2º arg (opts do contrato) não se aplica ao dom
    const r1 = await navegar(url);
    if (r1.html || r1.definitivo) return { html: r1.html, via: r1.via };
    await new Promise(r => setTimeout(r, 2000));
    console.error(`   [dom] retentando ${url}`);
    const r2 = await navegar(url);
    return { html: r2.html, via: r2.via };
  }

  async function fechar() {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
  }

  return { fetchFonte, estado, fechar };
}
