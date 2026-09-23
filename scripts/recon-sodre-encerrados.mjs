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
const troca = (obj, de, para) => JSON.parse(JSON.stringify(obj).split(`"${de}"`).join(`"${para}"`));
const variantes = [['original', base]];
for (const st of ['encerrado', 'finalizado', 'fechado', 'vendido', 'arrematado', 'sem_lance', 'condicional']) variantes.push([`aberto→${st}`, troca(base, 'aberto', st)]);
for (const st of ['andamento']) for (const novo of ['encerrado', 'vendido', 'finalizado', 'arrematado']) variantes.push([`andamento→${novo}`, troca(base, st, novo)]);
if (LOTES.length) variantes.push(['busca lot_id', { ...base, search: LOTES[0], q: LOTES[0], text: LOTES[0] }]);
if (LEILAO) variantes.push(['auction_id', { ...base, auction_id: [LEILAO], auctionId: LEILAO, auctions: [LEILAO] }]);
for (const [nome, body] of variantes) {
  const r = await page.evaluate(async (url, headers, b) => {
    try {
      const x = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...b, page: 1, perPage: 50 }), credentials: 'include' });
      const t = await x.text(); let j = null; try { j = JSON.parse(t); } catch { return { http: x.status, naoJson: t.slice(0, 120) }; }
      const arr = j.results || [];
      const dist = {};
      for (const l of arr) { const k = `${l.lot_status}|${l.lot_status_id}|${l.auction_status}|lance=${l.bid_has_bid}`; dist[k] = (dist[k] || 0) + 1; }
      return { http: x.status, total: j.total, n: arr.length, dist, ids: arr.slice(0, 3).map(l => l.lot_id) };
    } catch (e) { return { erro: e.message }; }
  }, reqInfo.url, hdrs, body);
  console.log(`[${nome}]`, JSON.stringify(r));
}
if (LOTES.length) console.log('procurados:', LOTES.join(','));
await browser.close();
