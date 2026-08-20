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
    // Conta sinais na página renderizada (após JS): R$ e links de lote.
    const info = await page.evaluate(() => {
      const reais = (document.body.innerText.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
      const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
        .filter(h => h && /(lote|imovel|leilao)/i.test(h));
      return { reais, hrefsAmostra: [...new Set(hrefs)].slice(0, 8) };
    });
    console.log(`   render: R$=${info.reais} · links lote:`, JSON.stringify(info.hrefsAmostra));
  } catch (e) { console.log(`   erro: ${String(e.message).slice(0, 100)}`); }
}

await browser.close();

console.log(`\n──────── RESPOSTAS JSON/XHR capturadas (${respostas.length}) ────────`);
const comLote = respostas.filter(r => r.temLote);
console.log(`\n>>> COM ARRAY DE LOTE (${comLote.length}):`);
for (const r of comLote) { console.log(`\n  ${r.url}  [${r.nLote} lotes, ${r.len}b]`); console.log(`    amostra: ${r.amostra}`); }
console.log(`\n>>> demais JSON (${respostas.length - comLote.length}):`);
for (const r of respostas.filter(r => !r.temLote).slice(0, 25)) console.log(`  ${r.url}  [${r.ct}, ${r.len}b]${r.amostra ? ' → ' + r.amostra.slice(0, 120) : ''}`);
