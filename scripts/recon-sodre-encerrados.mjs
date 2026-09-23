/**
 * RECON SODRÉ (só lê) — a API search-lots devolve lote ENCERRADO, e com que status? 23/09.
 * 399 veículos SODRE saíram do catálogo em 20/09 sem resultado apurado (a página é Nuxt SSR e não
 * diz "vendido" — por isso a SODRE está fora do cron de apuração). O coletor só pede lotes
 * abertos. Aqui: captura o corpo que o site manda, imprime-o, e testa variações — trocar o valor
 * "aberto" por status de encerramento e buscar lotes/leilão específicos dos 399 — imprimindo
 * lot_status/auction_status/bid_has_bid/bid_actual do que vier. Env: SODRE_LOTES, SODRE_LEILAO.
 */
import puppeteer from 'puppeteer';

const LOTES = (process.env.SODRE_LOTES || '').split(',').map(s => s.trim()).filter(Boolean);
const LEILAO = process.env.SODRE_LEILAO || '';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
let reqInfo = null;
page.on('request', req => { if (!reqInfo && /\/api\/search-lots/.test(req.url()) && req.method() === 'POST') reqInfo = { url: req.url(), body: req.postData() || '{}', headers: req.headers() }; });
await page.goto('https://www.sodresantoro.com.br/veiculos/lotes', { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => console.log('goto', e.message));
await new Promise(r => setTimeout(r, 3500));
if (!reqInfo) { console.log('search-lots não capturado'); await browser.close(); process.exit(1); }
console.log('URL:', reqInfo.url);
console.log('BODY:', reqInfo.body.slice(0, 1500));
const hdrs = { ...reqInfo.headers }; ['host', 'content-length', 'accept-encoding', 'connection'].forEach(h => delete hdrs[h]);
const base = JSON.parse(reqInfo.body);
// 23/09 (2ª rodada): a API é um Elasticsearch repassado — o corpo capturado tinha size:0 (só
// agregações), por isso as variantes vieram vazias. Aqui vão consultas ES próprias.
const idx = base.indices || ['veiculos', 'judiciais-veiculos'];
const consultas = [
  ['por lot_id (os 399)', { indices: idx, query: { terms: { lot_id: LOTES.map(Number) } }, size: 20 }],
  ['leilão inteiro', { indices: idx, query: { term: { auction_id: Number(LEILAO) } }, size: 5 }],
  ['vocabulário dos encerrados', { indices: idx, query: { term: { auction_status: 'encerrado' } }, size: 3,
    aggs: { ls: { terms: { field: 'lot_status', size: 30 } }, lsid: { terms: { field: 'lot_status_id', size: 30 } }, hb: { terms: { field: 'bid_has_bid', size: 5 } } } }],
];
for (const [nome, body] of consultas) {
  const r = await page.evaluate(async (url, headers, b) => {
    try {
      const x = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b), credentials: 'include' });
      const t = await x.text(); let j = null; try { j = JSON.parse(t); } catch { return { http: x.status, naoJson: t.slice(0, 200) }; }
      const arr = j.results || j.hits?.hits?.map(h => h._source) || [];
      return { http: x.status, chaves: Object.keys(j), total: j.total ?? j.hits?.total, n: arr.length,
        lotes: arr.slice(0, 20).map(l => ({ id: l.lot_id, ls: l.lot_status, lsid: l.lot_status_id, as: l.auction_status, lance: l.bid_has_bid, atual: l.bid_actual, ini: l.bid_initial, fim: l.lot_date_end })),
        aggs: j.aggregations || j.aggs || null };
    } catch (e) { return { erro: e.message }; }
  }, reqInfo.url, hdrs, body);
  console.log(`\n[${nome}]`, JSON.stringify(r).slice(0, 4000));
}
if (LOTES.length) console.log('procurados:', LOTES.join(','));
await browser.close();
