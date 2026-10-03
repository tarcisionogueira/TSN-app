/**
 * Recon da API pública do site ALBERTOMACEDO (03/10). O site é uma SPA sobre PostgREST
 * (api.albertomacedoleiloes.com.br/rest/v1) e o lote traz só `city_id`/`state_id` — a cidade não
 * aparece no texto da página, por isso o parser de DOM nunca a achou (12 lotes sem cidade).
 * Aqui: (1) abre o lote no Chromium e captura o header `apikey` que a PRÓPRIA página manda;
 * (2) refaz a consulta FORA do navegador com essa chave (prova que o coletor pode usá-la);
 * (3) traduz city_id/state_id pelas tabelas do site. NÃO grava nada. A chave é a pública
 * (anon) embutida no site — o log mostra só o tamanho, não o valor.
 */
import puppeteer from 'puppeteer';

const BASE = 'https://albertomacedoleiloes.com.br';
const API = 'https://api.albertomacedoleiloes.com.br/rest/v1';
const SLUG = process.env.RECON_SLUG || '5-apartamento-residencial-moema-1-dormitorios';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let apikey = null;
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('request', (req) => {
    if (!apikey && req.url().startsWith(API)) apikey = req.headers()['apikey'] || null;
  });
  await page.goto(`${BASE}/lote/${SLUG}`, { waitUntil: 'networkidle2', timeout: 45000 });
} finally { await browser.close(); }
console.log(`apikey capturada: ${apikey ? `sim (${apikey.length} chars, JWT=${/^eyJ/.test(apikey)})` : 'NÃO'}`);
if (!apikey) process.exit(1);

const h = { apikey, Authorization: `Bearer ${apikey}`, Accept: 'application/json' };
async function get(path) {
  const r = await fetch(`${API}/${path}`, { headers: h });
  const txt = await r.text();
  console.log(`GET ${path.slice(0, 110)} → HTTP ${r.status} · ${txt.length}b`);
  return r.ok ? JSON.parse(txt) : null;
}
const lote = (await get(`public_lots?select=slug,title,city_id,state_id,neighborhood_id,auction_id&slug=eq.${SLUG}`))?.[0];
console.log('lote:', JSON.stringify(lote));
for (const t of ['cities', 'municipalities', 'cidades']) {
  const c = lote?.city_id && await get(`${t}?select=*&id=eq.${lote.city_id}`);
  if (c?.length) { console.log(`cidade (${t}):`, JSON.stringify(c[0]).slice(0, 400)); break; }
}
const s = lote?.state_id && await get(`states?select=*&id=eq.${lote.state_id}`);
console.log('estado:', JSON.stringify(s?.[0] || null).slice(0, 300));
// Os 8 itens do pacote, para ver se TODOS têm city_id
const itens = lote?.auction_id && await get(`public_lots?select=slug,city_id,state_id&auction_id=eq.${lote.auction_id}`);
console.log('itens do pacote:', JSON.stringify(itens));
