/**
 * RECON de API do SODRE via navegador (nuvem) — tira o "molde" da API para reproduzir
 * com fetch depois. Loga no navegador real, abre um lote real e CAPTURA:
 *   - a AUTENTICAÇÃO: headers das chamadas à API (Authorization/Bearer) e cookies (token)
 *   - o ENDPOINT DE DOCUMENTOS do lote (URL) e a RESPOSTA (JSON com matrícula/edital/laudo)
 *   - a URL real do lote (leilao.sodresantoro.com.br/leilao/{id}/lote/{id})
 * Não grava nada. Roda no GitHub Actions. Credenciais SODRE_EMAIL/SODRE_SENHA.
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1360,900'];
const EMAIL = process.env.SODRE_EMAIL, SENHA = process.env.SODRE_SENHA;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RE_API = /sodresantoro\.com\.br\/api\/|prd-api\.sodresantoro/i;
const RE_DOC = /document|matricul|edital|laudo|anexo|arquivo|file/i;

async function login(page) {
  await page.goto('https://www.sodresantoro.com.br/login', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(1500);
  const r = await page.evaluate((email, senha) => {
    const vis = e => e && e.offsetParent !== null;
    const ins = [...document.querySelectorAll('input')].filter(vis);
    const pass = ins.find(i => i.type === 'password');
    const user = ins.find(i => /e-?mail|cpf|user|login|documento/i.test((i.name || '') + (i.id || '') + (i.placeholder || ''))) || ins.find(i => ['text', 'email'].includes(i.type));
    if (!user || !pass) return false;
    const set = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(user, email); set(pass, senha);
    const btn = (pass.closest('form') || document).querySelector('button[type=submit],button') || [...document.querySelectorAll('button,a')].find(b => /entrar|login|acessar/i.test(b.textContent || ''));
    if (btn) btn.click(); return true;
  }, EMAIL, SENHA);
  await Promise.race([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), sleep(6000)]);
  return r;
}

async function main() {
  if (!EMAIL || !SENHA) { console.log('SODRE_EMAIL/SENHA ausentes'); return; }
  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  const apiReq = [];   // {method,url,auth,hasCookie}
  const apiDoc = [];   // {url, body}
  page.on('request', req => {
    try { const u = req.url(); if (RE_API.test(u)) { const h = req.headers(); apiReq.push({ m: req.method(), u: u.slice(0, 140), auth: h['authorization'] ? h['authorization'].slice(0, 24) + '…' : '', cook: !!h['cookie'] }); } } catch { /* */ }
  });
  page.on('response', async r => {
    try {
      const u = r.url();
      if (RE_API.test(u) && RE_DOC.test(u)) {
        let body = ''; try { body = (await r.text()).slice(0, 900); } catch { body = '(sem corpo)'; }
        apiDoc.push({ u: u.slice(0, 140), s: r.status(), body });
      }
    } catch { /* */ }
  });

  try {
    const ok = await login(page);
    const cookies = await page.cookies();
    console.log(`login preenchido=${ok} url=${page.url()}`);
    console.log(`cookies: [${cookies.map(c => c.name).join(', ')}]`);
    const tok = cookies.find(c => /^token$/i.test(c.name));
    if (tok) console.log(`cookie token (prefixo): ${String(tok.value).slice(0, 30)}… len=${String(tok.value).length}`);

    // acha um leilão online e um lote real via API
    console.log('\n── procurando um lote real (API auctions)');
    let loteUrl = null;
    try {
      const aucs = await page.evaluate(async () => { const r = await fetch('https://prd-api.sodresantoro.com.br/api/v1/auctions?status=online', { credentials: 'include' }); return await r.json(); });
      const arr = Array.isArray(aucs) ? aucs : (aucs?.data || aucs?.auctions || []);
      console.log(`  auctions retornou ~${Array.isArray(arr) ? arr.length : 'n/d'} itens; chaves: ${JSON.stringify(Object.keys(aucs || {})).slice(0, 120)}`);
    } catch (e) { console.log(`  auctions ERRO ${e.message}`); }

    // navega pela listagem de imóveis e clica no 1º lote real
    await page.goto('https://www.sodresantoro.com.br/imoveis', { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(2500);
    const link = await page.evaluate(() => { const a = [...document.querySelectorAll('a[href]')].map(x => x.href).find(h => /leilao\.sodresantoro\.com\.br\/leilao\/\d+\/lote\/\d+/i.test(h)); return a || null; });
    console.log(`  lote real (listagem): ${link || '(não achou link direto)'}`);
    loteUrl = link;

    if (loteUrl) {
      console.log(`\n── abrindo o lote e capturando a API de documentos`);
      apiDoc.length = 0;
      await page.goto(loteUrl, { waitUntil: 'networkidle2', timeout: 40000 });
      await sleep(3500);
      // tenta expandir aba de documentos
      await page.evaluate(() => { const t = [...document.querySelectorAll('a,button,[role=tab]')].find(e => /documento|matr[ií]cul|edital|laudo/i.test(e.textContent || '')); if (t) t.click(); }).catch(() => {});
      await sleep(2500);
      const domDocs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => ({ t: (a.textContent || '').trim().slice(0, 24), h: a.href })).filter(a => /\.pdf|document|matr[ií]cul|edital|laudo|arquivo/i.test(a.t + a.h)).slice(0, 10));
      console.log(`  âncoras de doc no DOM: ${JSON.stringify(domDocs)}`);
    }

    console.log('\n══ AUTENTICAÇÃO — chamadas à API (amostra):');
    [...new Map(apiReq.map(x => [x.u, x])).values()].slice(0, 16).forEach(x => console.log(`   ${x.m} ${x.u} auth=${x.auth || '—'} cookie=${x.cook}`));
    console.log('\n══ ENDPOINTS DE DOCUMENTO (url + corpo):');
    apiDoc.slice(0, 6).forEach(d => console.log(`   [${d.s}] ${d.u}\n      body: ${d.body.replace(/\s+/g, ' ').slice(0, 500)}`));
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim recon API SODRE.');
}
main().catch(e => { console.error(e); process.exit(1); });
