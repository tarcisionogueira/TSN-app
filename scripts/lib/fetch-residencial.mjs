// Fetch RESIDENCIAL — passa o Cloudflare de um IP RESIDENCIAL, SEM Bright Data. Para os
// scrapers que usam BD por causa do Cloudflare (GESTAO, RJ, PECINI).
// IMPORTANTE: rodar de CASA — o Cloudflare bloqueia IP de datacenter mesmo com navegador real
// (por isso a CI usa BD). O puppeteer é importado LAZY: quem só usa BD/CI não precisa dele.
//
// ─── O NAVEGADOR VIROU REDE DE SEGURANÇA, NÃO O CAMINHO PADRÃO (30/08) ────────────────────
// Os três scrapers traziam, em comentário, a mesma justificativa: "o site está atrás de
// Cloudflare, TODO caminho responde 403 'Just a moment'". **Escrita quando os três rodavam de
// DATACENTER.** O Cloudflare decide desafiar pela reputação do IP — e a medição de casa
// (`scripts/testes/precisa-navegador.mjs`) mostrou os três respondendo `ok`, com marcador de
// verdade e sem desafio nenhum: RJ 30 URLs de lote na p.1 (+ detalhe abrindo), PECINI 61 lotes
// no sitemap (o Web Unlocker tinha enumerado 48 em 27/08 — o fetch puro vê MAIS), GESTAO 84
// eventos nos 5 domínios. Tempo no detalhe: 685 ms no RJ, 76 ms na PECINI — contra ~5 s de
// Chromium por página (jitter + espera fixa).
//
// **Mas uma amostra num instante não autoriza apagar o navegador.** O scraper real dispara
// centenas de requisições em rajada, e o Cloudflare pode desafiar por VOLUME sem desafiar a
// primeira. Então `fetchResidencial` tenta o fetch puro e cai no Chromium **só quando a
// resposta não serve** — quando o fetch funciona não custa nada, e quando o site endurecer a
// coleta continua em vez de zerar. Nunca fica pior que o comportamento anterior.
//
// O que decide "não serve" é o CHAMADOR, via `valido()`: o mesmo princípio da medição — o que
// vale é o marcador que o parser precisa, não o HTTP 200 (o desafio vem DENTRO de um 200, e o
// back-office do GESTAO devolve stub de 1,5 kB com 200).
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

const CABECALHOS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
};

// Quantas páginas cada caminho serviu nesta execução. É o número que diz se o navegador ainda
// está sendo exercitado — sem ele, "o fallback nunca dispara" e "o fallback dispara sempre"
// teriam exatamente a mesma aparência no log.
const _placar = { fetch: 0, navegador: 0, falha: 0 };
export function estatisticaResidencial() { return { ..._placar }; }

/**
 * FETCH PURO primeiro, Chromium como rede de segurança. Devolve string ou `null`.
 *
 * O `null` mantém o contrato do `fetchHeadless` (os três chamadores já o tratam), mas só sai
 * depois de os DOIS caminhos falharem — nunca como "a página está vazia".
 *
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {string} opts.charset  'windows-1252' no GESTAO (o back-office serve latin1; o
 *   navegador decodificava de graça e o fetch puro tem de fazer na mão — sem isto os acentos
 *   viram mojibake e some marcador acentuado: seria "o site mudou" no lugar de "eu decodifiquei
 *   errado"). O caminho do navegador NÃO redecodifica: ele já entrega texto.
 * @param {(html:string)=>boolean} opts.valido  o corpo tem o que o parser precisa? Falso →
 *   tenta o navegador. Default: só exige corpo não-vazio.
 */
export async function fetchResidencial(url, { timeoutMs = 60000, charset = 'utf-8', valido = null } = {}) {
  const serve = (h) => !!h && !ehChallenge(h) && (valido ? valido(h) : h.length > 0);
  let motivo;
  try {
    const r = await fetch(url, { headers: CABECALHOS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) motivo = `HTTP ${r.status}`;
    else {
      const buf = await r.arrayBuffer();
      const html = new TextDecoder(charset).decode(buf);
      if (serve(html)) { _placar.fetch++; return html; }
      motivo = ehChallenge(html) ? 'desafio Cloudflare' : `corpo não serve (${html.length} bytes)`;
    }
  } catch (e) {
    motivo = String(e?.message || e).slice(0, 120);
  }
  // Chegou aqui = o caminho barato não serviu. O motivo VAI para o log: sem ele, um fallback
  // permanente (site endureceu) e um fallback pontual ficariam indistinguíveis.
  console.error(`  [residencial] fetch puro não serviu em ${url} (${motivo}) — caindo no Chromium`);
  const h = await fetchHeadless(url, { timeoutMs });
  if (serve(h)) { _placar.navegador++; return h; }
  _placar.falha++;
  return null;
}

export async function fecharHeadless() {
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}
