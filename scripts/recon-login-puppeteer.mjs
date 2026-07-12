/**
 * RECON de LOGIN via NAVEGADOR (Puppeteer) — para leiloeiros que são apps JS (SODRE,
 * FRAZAO): preenche o formulário no DOM, loga, e CAPTURA A REDE (page.on('response'))
 * para revelar a API de auth (token/JWT) e como os documentos são servidos.
 *
 * Descobre, por fonte:
 *   - a página/rota real de login e se as credenciais autenticam (cookies/token/UI)
 *   - chamadas de rede relevantes: /api|/login|/auth|token|documento|cloudfront|cms/files|.pdf
 *   - uma URL de lote VÁLIDA (para SODRE, cujos url_lote no banco estão 404): pega da
 *     listagem/da API — e o que aparece de documento na página do lote autenticado.
 * NÃO grava nada. Roda no GitHub Actions. Config: RLP_FONTE (SODRE|FRAZAO), credenciais
 * <FONTE>_EMAIL/<FONTE>_SENHA (GL usa GL_*).
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1360,900'];
const FONTE = (process.env.RLP_FONTE || '').toUpperCase();
const BASES = { SODRE: 'https://www.sodresantoro.com.br', FRAZAO: 'https://www.frazaoleiloes.com.br', GRUPOLANCE: 'https://www.grupolance.com.br' };
const CRED_PREFIX = { GRUPOLANCE: 'GL' };
const P = CRED_PREFIX[FONTE] || FONTE;
const EMAIL = process.env[`${P}_EMAIL`], SENHA = process.env[`${P}_SENHA`];
const RE_REDE = /\/api\/|\/login|\/auth|token|autentic|documento|matricul|edital|laudo|cloudfront|cms\/files|\.pdf/i;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function preencherESubmeter(page) {
  // Acha input de email/usuário e de senha no DOM (renderizado por JS) e submete.
  const res = await page.evaluate((email, senha) => {
    const vis = (el) => el && el.offsetParent !== null;
    const inputs = [...document.querySelectorAll('input')].filter(vis);
    const pass = inputs.find(i => i.type === 'password');
    const user = inputs.find(i => /e-?mail|user|usuario|login|cpf|documento/i.test((i.name || '') + (i.id || '') + (i.placeholder || '') + (i.type || '')))
      || inputs.find(i => ['text', 'email'].includes(i.type));
    if (!user || !pass) return { ok: false, achou: { user: !!user, pass: !!pass, nInputs: inputs.length } };
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(user, email); set(pass, senha);
    const form = pass.closest('form');
    const btn = (form || document).querySelector('button[type=submit], input[type=submit], button')
      || [...document.querySelectorAll('button,a')].find(b => /entrar|login|acessar|acesso/i.test(b.textContent || ''));
    return { ok: true, userSel: user.name || user.id || user.placeholder, passSel: pass.name || pass.id, temForm: !!form, temBtn: !!btn, btnTxt: btn ? (btn.textContent || btn.value || '').trim().slice(0, 30) : '' };
  }, EMAIL, SENHA);
  if (!res.ok) return res;
  // clica submit e espera
  await page.evaluate(() => {
    const pass = [...document.querySelectorAll('input')].find(i => i.type === 'password');
    const form = pass && pass.closest('form');
    const btn = (form || document).querySelector('button[type=submit], input[type=submit], button')
      || [...document.querySelectorAll('button,a')].find(b => /entrar|login|acessar|acesso/i.test(b.textContent || ''));
    if (btn) btn.click(); else if (form) form.submit();
  });
  await Promise.race([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), sleep(6000)]);
  return res;
}

async function main() {
  if (!BASES[FONTE]) { console.error(`RLP_FONTE inválido (${FONTE})`); process.exit(1); }
  const BASE = BASES[FONTE];
  console.log(`\n🧭 Recon login (navegador) ${FONTE} — creds ${P}_EMAIL/${P}_SENHA: ${EMAIL ? 'ok' : 'AUSENTE'}/${SENHA ? 'ok' : 'AUSENTE'}`);
  if (!EMAIL || !SENHA) { console.log('=> credenciais ausentes'); return; }

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const rede = [];
  page.on('response', (r) => {
    try { const u = r.url(); if (RE_REDE.test(u)) rede.push(`${r.request().method()} ${r.status()} ${r.headers()['content-type'] || ''} ${u.slice(0, 150)}`); } catch { /* */ }
  });

  try {
    // rotas de login candidatas por fonte
    const rotas = FONTE === 'SODRE' ? ['/login'] : FONTE === 'FRAZAO' ? ['/minha-conta', '/entrar', '/login', '/wp-login.php', '/'] : ['/entrar'];
    let logou = false, usouRota = null, detalhe = null;
    for (const rota of rotas) {
      try {
        console.log(`\n── tentando login em ${BASE}${rota}`);
        await page.goto(BASE + rota, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(1500);
        // se a rota não tem input de senha, procura um gatilho "Entrar" e clica (modal)
        const temPass = await page.evaluate(() => !!document.querySelector('input[type=password]'));
        if (!temPass) {
          const abriu = await page.evaluate(() => { const t = [...document.querySelectorAll('a,button')].find(e => /entrar|login|acessar|minha conta/i.test(e.textContent || '')); if (t) { t.click(); return true; } return false; });
          if (abriu) await sleep(2000);
        }
        detalhe = await preencherESubmeter(page);
        console.log(`   preenchimento: ${JSON.stringify(detalhe)}`);
        const estado = await page.evaluate(() => ({ url: location.href, logout: /sair|logout|minha[- ]conta|meus[- ]lances|ol[áa],|bem[- ]vindo/i.test(document.body.innerText || '') }));
        const cookies = await page.cookies();
        console.log(`   após submit: url=${estado.url} indicioLogado=${estado.logout} cookies=[${cookies.map(c => c.name).join(', ')}]`);
        if (estado.logout || cookies.some(c => /token|session|auth|logged/i.test(c.name))) { logou = true; usouRota = rota; break; }
      } catch (e) { console.log(`   ERRO ${e.message}`); }
    }
    console.log(`\n  => login ${logou ? 'PROVÁVEL' : 'não confirmado'} (rota ${usouRota || '—'})`);

    // pega uma URL de lote real a partir da listagem/busca de imóveis
    console.log('\n── procurando uma URL de lote válida na listagem');
    for (const path of ['/imoveis', '/busca?categoria=imoveis', '/lotes', '/']) {
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(1500);
        const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /imove|lote|oferta/i.test(h)).slice(0, 8));
        if (links.length) {
          console.log(`   [${path}] exemplos: ${links.slice(0, 4).join(' | ')}`);
          // abre o 1º lote e reporta documentos/rede
          rede.length = 0;
          await page.goto(links[0], { waitUntil: 'networkidle2', timeout: 40000 });
          await sleep(2500);
          const info = await page.evaluate(() => {
            const pdfs = (document.documentElement.outerHTML.match(/https?:[^"'\s)]+\.pdf/gi) || []).length;
            const docAnchors = [...document.querySelectorAll('a,button')].filter(e => /matr[ií]cul|edital|laudo|documento|avalia|regras/i.test(e.textContent || '')).map(e => ({ t: (e.textContent || '').trim().slice(0, 24), href: e.getAttribute('href') || '', du: e.getAttribute('data-url') || e.getAttribute('data-href') || '' }));
            return { url: location.href, pdfs, docAnchors: docAnchors.slice(0, 8) };
          });
          console.log(`   lote aberto: ${info.url}`);
          console.log(`   pdfs no DOM=${info.pdfs} | âncoras de doc: ${JSON.stringify(info.docAnchors)}`);
          break;
        } else { console.log(`   [${path}] nenhum link de lote`); }
      } catch (e) { console.log(`   [${path}] ERRO ${e.message}`); }
    }

    console.log('\n── rede capturada (auth/doc):');
    [...new Set(rede)].slice(0, 30).forEach(l => console.log(`   ${l}`));
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim do recon (navegador).');
}

main().catch((e) => { console.error(e); process.exit(1); });
