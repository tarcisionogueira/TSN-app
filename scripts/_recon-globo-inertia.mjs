// Recon DESCARTÁVEL — GLOBOLEILOES virou uma SPA Inertia.js (Laravel+Inertia+React) e o
// parser antigo (globo-parse.mjs, baseado em <article>/<a href>) para de achar qualquer lote
// desde então: 3 rodadas reais independentes deram 0. Objetivo único: ver COMO os dados
// realmente chegam — data-page (Inertia SSR/CSR embutido) e/ou chamadas XHR (Inertia navega
// trocando só o corpo via fetch com header X-Inertia) — antes de escrever qualquer parser
// novo. NÃO grava nada. Roda no GitHub Actions (egress liberado).
import puppeteer from 'puppeteer';
import { fetchUnlockerContado } from './lib/bd-ledger.mjs';

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

  // ── FASE 2 (17/09) — Cloudflare bloqueou TUDO no Puppeteer cru (403 em / e nos 3 paths).
  // Achado NOVO: o leiloeiro_conhecimento dizia "SEM Cloudflare" em 07/09 — o site ganhou essa
  // proteção depois disso, em cima da migração pra Inertia.js. Tenta o Bright Data Web Unlocker
  // (mesmo produto já aprovado/usado no Pecini) — (a) HTML normal, pra achar data-page; (b) com
  // header X-Inertia:true, que faz o Inertia responder só o JSON da página (sem HTML em volta),
  // se o servidor aceitar a requisição vindo do Unlocker.
  console.log('\n\n══════════════════ FASE 2 — Bright Data Web Unlocker ══════════════════');
  for (const { rotulo, path, headers } of [
    { rotulo: 'home (HTML normal)', path: '/', headers: {} },
    { rotulo: 'home (X-Inertia:true)', path: '/', headers: { 'X-Inertia': 'true', Accept: 'text/html, application/xhtml+xml' } },
    { rotulo: '/leiloes (X-Inertia:true)', path: '/leiloes', headers: { 'X-Inertia': 'true', Accept: 'text/html, application/xhtml+xml' } },
  ]) {
    console.log(`\n── ${rotulo} — ${BASE}${path}`);
    try {
      const r = await fetchUnlockerContado({
        body: JSON.stringify({ url: BASE + path, method: 'GET', headers: { 'User-Agent': UA, ...headers } }),
      });
      const html = await r.text().catch(() => '');
      console.log('  HTTP', r.status, '· len', html.length);
      const cloudflare = /just a moment|challenge-platform|cf-chl/i.test(html);
      if (cloudflare) { console.log('  ainda Cloudflare — desafio intacto'); continue; }
      // Resposta X-Inertia costuma vir como JSON puro (sem HTML em volta) quando aceita.
      try { const j = JSON.parse(html); console.log('  ⭐ JSON PURO (Inertia aceitou o header) — chaves:', Object.keys(j)); console.log('  dump(6000):', JSON.stringify(j).slice(0, 6000)); continue; } catch { /* não é JSON puro, segue pro data-page */ }
      const dp = extrairDataPage(html);
      if (dp) { console.log('  data-page achado — component:', dp.component, '· props chaves:', dp.props ? Object.keys(dp.props) : null); console.log('  dump(6000):', JSON.stringify(dp).slice(0, 6000)); }
      else console.log('  sem data-page e sem JSON — raw[0..600]:', html.slice(0, 600).replace(/\s+/g, ' '));
    } catch (e) { console.log('  ERRO:', String(e.message || e).slice(0, 200)); }
  }

  console.log('\n✅ recon concluído.');
})();
