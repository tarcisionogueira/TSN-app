/**
 * Recon RUNTIME COM NAVEGADOR — GENÉRICO (ferramenta do motor `dom`, Passo 2). Renderiza as
 * rotas dadas num Chromium headless (Puppeteer, grátis no runner), conta R$ na tela, dumpa o
 * HTML do CARD ao redor do 1º preço (estrutura p/ o parser de DOM) e INTERCEPTA respostas
 * JSON/XHR (se a fonte tiver uma API escondida, é melhor que raspar o DOM). NÃO grava.
 *
 * Env: RECON_BASE (ex.: https://www.alfaleiloes.com.br) · RECON_ROTAS (csv de caminhos).
 * Reaproveita a lógica desenhada no recon-nordeste-browser.mjs, agora parametrizada por env.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.RECON_BASE || process.env.NORDESTE_BASE;
const ROTAS = (process.env.RECON_ROTAS || '/').split(',').map(s => s.trim()).filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
if (!BASE) { console.log('⚠️ defina RECON_BASE'); process.exit(1); }

const pareceLote = (o) => {
  if (!o || typeof o !== 'object') return false;
  const k = Object.keys(o);
  return k.some(x => /(valor|lance|avaliac|slug|cidade|titulo|endereco|imovel|lote|praca|matricula)/i.test(x)) && k.length >= 4;
};
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

const respostas = [];
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
    respostas.push({ url: url.slice(0, 180), ct: ct.split(';')[0], len: txt.length, temLote: !!arr, nLote: arr?.length || 0, amostra: arr?.length ? JSON.stringify(arr[0]).slice(0, 1000) : (txt.length < 300 ? txt : '') });
  } catch { /* ignora */ }
});

for (const rota of ROTAS) {
  const url = BASE + rota;
  try {
    console.log(`\n=== navegando ${url} ===`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const info = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const reais = [...txt.matchAll(/R\$\s?[\d.]+,\d{2}/g)].map(m => m[0]).slice(0, 10);
      const rotulado = [];
      // rótulos ao redor de R$ (avaliação/lance/1ª/2ª praça) — o que o parser precisa mapear
      for (const m of txt.matchAll(/(.{0,32})R\$\s?([\d.]+,\d{2})/g)) { rotulado.push(`${m[1].replace(/\s+/g, ' ').trim()} → R$ ${m[2]}`); if (rotulado.length >= 8) break; }
      const area = (txt.match(/[\d.]+,?\d*\s*m[²2]/i) || [])[0] || '';
      const cidade = (txt.match(/(?:comarca|cidade|munic[íi]pio|em)\s+[A-ZÀ-Ú][^.,;\n]{2,40}\/?\s*[A-Z]{2}?/i) || [])[0] || '';
      let cardHtml = '';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (/R\$\s?[\d.]+,\d{2}/.test(n.nodeValue)) { cardHtml = (n.parentElement?.closest('article, li, [class*="card"], [class*="lote"], div')?.outerHTML || '').slice(0, 1200); break; }
      }
      // hrefs RENDERIZADOS que parecem lote/listagem — é o que decide o padrão de URL do
      // enumerador (a lição do nordeste: a home crua não linka nada; o DOM sim).
      const hrefs = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || ''))]
        .filter(h => /lote|leilao|leiloes|imove|evento|agenda/i.test(h) && !/facebook|instagram|whatsapp|wa\.me|blog|\.pdf$/i.test(h))
        .slice(0, 60);
      return { nReais: reais.length, rotulado, area, cidade, cardHtml, hrefs };
    });
    console.log(`   render: R$=${info.nReais} · área="${info.area}" · cidade="${info.cidade}"`);
    info.rotulado.forEach(r => console.log(`     ${r}`));
    console.log(`   hrefs lote/listagem (${info.hrefs.length}): ${JSON.stringify(info.hrefs)}`);
    if (info.cardHtml) console.log(`   card: ${info.cardHtml.replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`   erro: ${String(e.message).slice(0, 100)}`); }
}

await browser.close();
console.log(`\n──────── JSON/XHR capturados (${respostas.length}) ────────`);
const comLote = respostas.filter(r => r.temLote);
console.log(`>>> COM ARRAY DE LOTE (${comLote.length}) — se houver, o parser lê a API, não o DOM:`);
for (const r of comLote) { console.log(`  ${r.url}  [${r.nLote} lotes, ${r.len}b]`); console.log(`    amostra: ${r.amostra}`); }
console.log(`>>> demais JSON (${respostas.length - comLote.length}):`);
for (const r of respostas.filter(r => !r.temLote).slice(0, 20)) console.log(`  ${r.url}  [${r.ct}, ${r.len}b]${r.amostra ? ' → ' + r.amostra.slice(0, 120) : ''}`);
