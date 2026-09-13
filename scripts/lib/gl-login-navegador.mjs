/**
 * Login no Grupo Lance via NAVEGADOR (Puppeteer) — fallback de `loginGrupoLance()`
 * (api/_grupolance-auth.js, fetch simples).
 *
 * Por que existe (13/09): o fetch simples passou a tomar 403 na PRIMEIRA requisição
 * (GET /entrar, sem sequer ver o formulário) em toda rodada do cron desde pelo menos
 * 09/09 — mas o scraper de listagem pública do mesmo site (sem login) segue coletando
 * normal na mesma rodada, mesma origem (GitHub Actions). Não é bloqueio de IP de
 * datacenter (esse é o caso do HASTA, sem solução daqui): é o WAF barrando
 * especificamente a rota de login quando quem bate é `fetch()` cru, sem JS.
 * `recon-login-puppeteer.mjs` confirmou ao vivo (13/09): o MESMO IP de Actions,
 * pedindo com um navegador de verdade, loga sem 403 (cookies GLSESSIONID/_csrf
 * emitidos normalmente). Fica em arquivo separado (não em `_grupolance-auth.js`) de
 * propósito: aquele módulo também é importado por `api/_leiloeiro-auth.js`, que roda
 * dentro de função serverless da Vercel — puxar puppeteer para lá infla o bundle e
 * arrisca quebrar produção por um caminho que só faz sentido no runner do GitHub Actions.
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.grupolance.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1360,900'];

// Devolve o cookie jar autenticado no MESMO formato de loginGrupoLance() ({nome: valor}),
// para o resto do pipeline (coletarDocsGrupoLance/baixarDoc/resolverDocUrl, fetch-based)
// funcionar sem mudança nenhuma.
export async function loginGrupoLanceNavegador() {
  const email = process.env.GL_EMAIL || process.env.ZUK_EMAIL;
  const senha = process.env.GL_SENHA || process.env.ZUK_SENHA;
  if (!email || !senha) { console.log('[gl-auth-navegador] GL_EMAIL/GL_SENHA (nem ZUK_*) presentes'); return null; }

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(`${BASE}/entrar`, { waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 1000));

    const preencheu = await page.evaluate((email, senha) => {
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const user = document.querySelector('input[name="LoginForm[username]"]');
      const pass = document.querySelector('input[name="LoginForm[password]"]');
      if (!user || !pass) return false;
      set(user, email); set(pass, senha);
      const form = pass.closest('form');
      const btn = (form || document).querySelector('button[type=submit], input[type=submit]');
      if (btn) btn.click(); else if (form) form.submit();
      return true;
    }, email, senha);
    if (!preencheu) { console.log('[gl-auth-navegador] formulário de login não encontrado no DOM'); return null; }

    await Promise.race([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);

    const cookiesPuppeteer = await page.cookies();
    const jar = {};
    for (const c of cookiesPuppeteer) jar[c.name] = c.value;
    if (!jar.GLSESSIONID) { console.log(`[gl-auth-navegador] login sem GLSESSIONID (cookies=[${Object.keys(jar).join(',')}])`); return null; }
    return jar;
  } catch (e) {
    console.log(`[gl-auth-navegador] erro: ${e?.message || e}`);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}
