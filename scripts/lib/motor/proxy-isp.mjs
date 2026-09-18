/**
 * Proxy ISP do Bright Data — produto SEPARADO do Web Unlocker (`api/_brightdata.js`). Existe
 * para fontes que bloqueiam por REPUTAÇÃO DE IP de datacenter (não paywall JS/Cloudflare, que
 * o Web Unlocker já resolve) — o mesmo motivo pelo qual HASTA/RJ/PECINI/GESTAO/GLOBOLEILOES
 * hoje só coletam pelo runner RESIDENCIAL (IP de casa do dono, `runner-residencial.sh`).
 *
 * Custo é fixo por IP + tráfego (não por requisição) — por isso NÃO usa o freio de cota de
 * `_brightdata.js` (`brightdata_uso`), que é orçamento de um produto diferente.
 *
 * Sem as três env vars configuradas → `proxyIspDisponivel()` retorna false e o chamador segue
 * sem proxy (mesmo comportamento de hoje). Uso é OPT-IN por chamador (`usarProxyIsp` em
 * `criarMotorDom`) — nada muda para quem já roda pelo runner residencial.
 *
 * Env vars (Vercel + GitHub Actions secrets): BRIGHTDATA_ISP_HOST, BRIGHTDATA_ISP_USER,
 * BRIGHTDATA_ISP_PASS.
 */
const HOST = process.env.BRIGHTDATA_ISP_HOST;
const USER = process.env.BRIGHTDATA_ISP_USER;
const PASS = process.env.BRIGHTDATA_ISP_PASS;

export function proxyIspDisponivel() {
  return !!(HOST && USER && PASS);
}

/** Argumento `--proxy-server` do Chromium. O Chromium não aceita user:pass embutido na URL. */
export function proxyIspServidor() {
  return proxyIspDisponivel() ? `http://${HOST}` : null;
}

/** Credenciais para `page.authenticate(...)`, chamado por página (Puppeteer exige por-página). */
export function proxyIspCredenciais() {
  return proxyIspDisponivel() ? { username: USER, password: PASS } : null;
}
