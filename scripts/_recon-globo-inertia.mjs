// Recon DESCARTÁVEL — GLOBOLEILOES virou uma SPA Inertia.js (Laravel+Inertia+React) e o
// parser antigo (globo-parse.mjs, baseado em <article>/<a href>) para de achar qualquer lote
// desde então: 3 rodadas reais independentes deram 0. Objetivo único: ver COMO os dados
// realmente chegam — data-page (Inertia SSR/CSR embutido) e/ou chamadas XHR (Inertia navega
// trocando só o corpo via fetch com header X-Inertia) — antes de escrever qualquer parser
// novo. NÃO grava nada. Roda no GitHub Actions (egress liberado).
import puppeteer from 'puppeteer';

const BASE = 'https://globoleiloes.com.br';
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extrairDataPage(html) {
  const m = String(html || '').match(/data-page=(["'])([\s\S]*?)\1/i);
  if (!m) return null;
  const decoded = m[2]
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { return JSON.parse(decoded); } catch (e) { return { _erroParse: String(e.message), _amostra: decoded.slice(0, 400) }; }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });

  const xhrInertia = [];
  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const headers = req.headers();
      const isInertia = headers['x-inertia'] === 'true' || (resp.headers()['x-inertia'] === 'true');
      const ct = resp.headers()['content-type'] || '';
      if (!isInertia && !/json/i.test(ct)) return;
      const url = resp.url();
      if (/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|css)(\?|$)/i.test(url)) return;
      let body = '';
      try { body = (await resp.text()).slice(0, 4000); } catch { /* consumido */ }
      xhrInertia.push({ url, status: resp.status(), isInertia, ct, body });
    } catch { /* ignora */ }
  });

  console.log(`══════ HOME (raw, sem esperar hidratação extra) — ${BASE}/ ══════`);
  const resp1 = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => { console.log('goto falhou:', e.message); return null; });
  console.log('HTTP', resp1 ? resp1.status() : '?');
  const html0 = await page.content();
  console.log('len HTML imediato:', html0.length);
  const dp0 = extrairDataPage(html0);
  console.log('data-page (imediato):', dp0 ? JSON.stringify(dp0).slice(0, 2000) : 'não achado');

  console.log('\n⏳ esperando 8s de hidratação/XHR...');
  await new Promise((r) => setTimeout(r, 8000));
  const html1 = await page.content();
  console.log('len HTML após espera:', html1.length);
  const temLote = [...new Set((html1.match(/\/leiloes\/lote-[^"'\s)]+/gi) || []))];
  console.log('links /leiloes/lote- após espera:', JSON.stringify(temLote.slice(0, 10)), `(total ${temLote.length})`);
  const dp1 = extrairDataPage(html1);
  if (dp1) {
    console.log('data-page (após espera) — chaves de topo:', Object.keys(dp1));
    console.log('data-page (após espera) — component:', dp1.component);
    console.log('data-page (após espera) — props (chaves):', dp1.props ? Object.keys(dp1.props) : null);
    console.log('data-page (após espera) — dump (6000):', JSON.stringify(dp1).slice(0, 6000));
  }

  // Tenta navegar para /leiloes (rota plausível de listagem) via link real, se existir, ou goto direto.
  for (const path of ['/leiloes', '/imoveis', '/leiloes/imoveis']) {
    console.log(`\n══════ ${path} ══════`);
    try {
      const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      console.log('HTTP', r ? r.status() : '?');
      await new Promise((res) => setTimeout(res, 5000));
      const html = await page.content();
      const lotes = [...new Set((html.match(/\/leiloes\/lote-[^"'\s)]+/gi) || []))];
      console.log('len', html.length, '· links de lote:', JSON.stringify(lotes.slice(0, 8)), `(total ${lotes.length})`);
      const dp = extrairDataPage(html);
      if (dp) console.log('data-page component:', dp.component, '· props chaves:', dp.props ? Object.keys(dp.props) : null);
    } catch (e) { console.log('ERRO:', e.message); }
  }

  console.log(`\n\n▓▓ Respostas Inertia/JSON interceptadas (${xhrInertia.length}):`);
  for (const x of xhrInertia) {
    console.log(`\n• [${x.status}]${x.isInertia ? ' (X-Inertia)' : ''} ${x.url}`);
    console.log('  corpo:', x.body);
  }

  await browser.close();
  console.log('\n✅ recon concluído.');
})();
