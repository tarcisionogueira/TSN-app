/**
 * RECON (navegador) — a API da SUPERBID informa o RESULTADO de oferta encerrada? 23/09/2026.
 * Só LÊ e imprime. Roda no GitHub Actions.
 *
 * Contexto: 2.168 veículos SUPERBID vencidos e ZERO apurados. `fetch` de servidor — até do
 * GitHub — leva 403 do Cloudflare na página e na API (recon-resultado-sbid-cef, run
 * 35880941738). O coletor funciona porque chama a API DE DENTRO de um navegador que entrou no
 * site (mesmo padrão aqui: goto no site, depois page.evaluate(fetch)). Pergunta: com o id de uma
 * oferta já encerrada, a offer-query devolve a oferta, e em qual campo vem vendido/sem lance?
 *
 * Env: SBID_IDS (vírgula).
 */
import puppeteer from 'puppeteer';

const IDS = (process.env.SBID_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
await page.goto('https://www.superbid.net/categorias/imoveis', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto:', e.message));
await new Promise(r => setTimeout(r, 3000));

const out = await page.evaluate(async (ids) => {
  const RE = /status|situa|vend|sold|winner|vencedor|arremat|lance|bid|closed|encerr|deserto|licitant|result|finish/i;
  const campos = (obj, cam = '', acc = []) => {
    if (acc.length > 50) return acc;
    if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) campos(v, cam ? `${cam}.${k}` : k, acc); }
    else if (obj !== null && obj !== undefined && RE.test(cam.split('.').slice(-2).join('.'))) acc.push(`${cam}=${String(obj).slice(0, 70)}`);
    return acc;
  };
  const res = [];
  for (const id of ids) {
    const r = { id, tentativas: [] };
    const urls = [
      ['opened', `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&searchType=opened&filter=id:${id}&pageNumber=1&pageSize=5`],
      ['closed', `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&searchType=closed&filter=id:${id}&pageNumber=1&pageSize=5`],
      ['finished', `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&searchType=finished&filter=id:${id}&pageNumber=1&pageSize=5`],
      ['sem_searchType', `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&filter=id:${id}&pageNumber=1&pageSize=5`],
      ['por_id', `https://offer-query.superbid.net/offers/${id}?locale=pt_BR`],
    ];
    for (const [nome, u] of urls) {
      try {
        const x = await fetch(u, { headers: { Accept: 'application/json' } });
        const t = await x.text();
        let j = null; try { j = JSON.parse(t); } catch { /* não-JSON */ }
        const lista = j ? (j.offers || j.content || j.results || j.items || (Array.isArray(j) ? j : (j.id ? [j] : []))) : [];
        const of = lista.find(o => String(o?.id) === String(id)) || lista[0] || null;
        r.tentativas.push({ nome, http: x.status, n: lista.length, total: j?.total ?? j?.totalElements ?? null, campos: of ? campos(of) : [], inicio: j ? null : t.slice(0, 100) });
      } catch (e) { r.tentativas.push({ nome, erro: String(e.message || e) }); }
    }
    res.push(r);
  }
  return res;
}, IDS);

for (const r of out) {
  console.log(`\n══════ oferta ${r.id}`);
  for (const t of r.tentativas) {
    console.log(`  [${t.nome}] http=${t.http ?? '-'} ofertas=${t.n ?? '-'} total=${t.total ?? '-'}${t.erro ? ` erro=${t.erro}` : ''}${t.inicio ? ` nao-json=${t.inicio}` : ''}`);
    for (const c of (t.campos || [])) console.log('      ' + c);
  }
}
await browser.close();
