/**
 * Recon RUNTIME COM NAVEGADOR — nordesteleiloes (Next.js App Router).
 * ==================================================================
 * O recon estático (recon-nordeste.mjs) provou que a home é marketing (0 R$, 0 links de lote)
 * e que o catálogo de imóveis carrega CLIENT-SIDE via XHR — invisível ao HTML/bundle. Aqui um
 * Chromium headless (Puppeteer, grátis no runner) NAVEGA e INTERCEPTA a rede: registra toda
 * resposta JSON/XHR e dumpa a que traz array de lote — é o contrato de API real p/ o parser.
 * NÃO grava nada. (Modelo: recon-zuk-edital.mjs.)
 */
import puppeteer from 'puppeteer';

const BASE = process.env.NORDESTE_BASE || 'https://www.nordesteleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
// Rotas prováveis do catálogo de imóveis (a home não linka; tentamos as canônicas + busca).
const ROTAS = (process.env.NORDESTE_ROTAS || '/,/leiloes/ao-vivo,/leiloes/imoveis,/imoveis,/busca/imoveis,/categoria/imovel').split(',');

const pareceLote = (obj) => {
  if (!obj || typeof obj !== 'object') return false;
  const k = Object.keys(obj);
  return k.some(x => /(valor|lance|avaliac|slug|cidade|titulo|endereco|imovel|lote|praca|matricula)/i.test(x)) && k.length >= 4;
};
// Fareja, em qualquer JSON, o 1º array de objetos que parecem lote.
function acharArrayLote(node, prof = 0) {
  if (prof > 8 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length && pareceLote(node[0])) return node;
    for (const v of node) { const r = acharArrayLote(v, prof + 1); if (r) return r; }
    return null;
  }
  for (const v of Object.values(node)) { const r = acharArrayLote(v, prof + 1); if (r) return r; }
  return null;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setUserAgent(UA);

const respostas = [];  // {url, ct, len, temLote, amostra}
page.on('response', async (resp) => {
  try {
    const ct = resp.headers()['content-type'] || '';
    const url = resp.url();
    if (!/json/i.test(ct)) return;
    if (/_next\/static|fonts\.|\.css|\.js($|\?)/i.test(url)) return;
    const txt = await resp.text().catch(() => '');
    if (!txt || txt.length < 40) return;
    let json; try { json = JSON.parse(txt); } catch { return; }
    const arr = acharArrayLote(json);
    respostas.push({
      url: url.slice(0, 180), ct: ct.split(';')[0], len: txt.length,
      temLote: !!arr, nLote: arr?.length || 0,
      amostra: arr?.length ? JSON.stringify(arr[0]).slice(0, 900) : (txt.length < 300 ? txt : ''),
    });
  } catch { /* ignora */ }
});

for (const rota of ROTAS) {
  const url = BASE + rota.trim();
  try {
    console.log(`\n=== navegando ${url} ===`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));   // deixa XHR pós-hydration completar
    // Página renderizada (após JS): conta R$, dumpa TODOS os hrefs (p/ achar padrão de lote +
    // link de catálogo) e o HTML do CARD ao redor do 1º R$ (estrutura p/ o scraper de DOM).
    const info = await page.evaluate(() => {
      const reais = (document.body.innerText.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
      const hrefs = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(Boolean))];
      // Card: sobe do 1º nó com "R$" até um <a> ancestral (o card costuma ser um link).
      let cardHtml = '', cardHref = '';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (/R\$\s?[\d.]+,\d{2}/.test(n.nodeValue)) {
          let el = n.parentElement, saltos = 0;
          while (el && saltos < 8) { if (el.tagName === 'A' && el.getAttribute('href')) { cardHref = el.getAttribute('href'); break; } el = el.parentElement; saltos++; }
          const card = (el && el.tagName === 'A') ? el : n.parentElement?.closest('article, li, [class*="card"], div');
          cardHtml = (card?.outerHTML || '').slice(0, 1400);
          break;
        }
      }
      return { reais, hrefs: hrefs.slice(0, 45), cardHref, cardHtml };
    });
    console.log(`   render: R$=${info.reais}`);
    console.log(`   hrefs (${info.hrefs.length}):`, JSON.stringify(info.hrefs));
    if (info.cardHref || info.cardHtml) {
      console.log(`   card href: ${info.cardHref}`);
      console.log(`   card HTML: ${info.cardHtml.replace(/\s+/g, ' ')}`);
    }
  } catch (e) { console.log(`   erro: ${String(e.message).slice(0, 100)}`); }
}

await browser.close();

console.log(`\n──────── RESPOSTAS JSON/XHR capturadas (${respostas.length}) ────────`);
const comLote = respostas.filter(r => r.temLote);
console.log(`\n>>> COM ARRAY DE LOTE (${comLote.length}):`);
for (const r of comLote) { console.log(`\n  ${r.url}  [${r.nLote} lotes, ${r.len}b]`); console.log(`    amostra: ${r.amostra}`); }
console.log(`\n>>> demais JSON (${respostas.length - comLote.length}):`);
for (const r of respostas.filter(r => !r.temLote).slice(0, 25)) console.log(`  ${r.url}  [${r.ct}, ${r.len}b]${r.amostra ? ' → ' + r.amostra.slice(0, 120) : ''}`);
