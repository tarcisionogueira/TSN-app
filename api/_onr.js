/**
 * Helper de autenticação e chamadas ao RI Digital (ridigital.org.br).
 * Sistema: ASP.NET WebForms + ASHX handlers via cookie de sessão.
 *
 * Fluxo:
 * 1. GET /FAcesso.aspx → extrai __VIEWSTATE, __EVENTVALIDATION e nomes dos campos
 * 2. POST /FAcesso.aspx com credenciais → obtém cookie de sessão
 * 3. Chamadas autenticadas: POST /ajax/{handler}.ashx?_method={method}&_session=yes
 *    com o cookie de sessão no header
 */

const BASE = 'https://ridigital.org.br';
const AJAX = `${BASE}/ajax`;

// Cache em memória (por instância da função serverless)
let _sessionCache = { cookie: null, expiresAt: 0 };

/** Extrai o valor de um input hidden do HTML por nome ou id */
function extractInput(html, name) {
  const byName = html.match(new RegExp(`name="${escapeReg(name)}"[^>]*value="([^"]*)"`, 'i'));
  if (byName) return byName[1];
  const byId = html.match(new RegExp(`id="${escapeReg(name)}"[^>]*value="([^"]*)"`, 'i'));
  if (byId) return byId[1];
  const valueFirst = html.match(new RegExp(`value="([^"]*)"[^>]*(?:name|id)="${escapeReg(name)}"`, 'i'));
  return valueFirst ? valueFirst[1] : '';
}
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Tenta encontrar o nome do campo de email/login no HTML */
function findEmailField(html) {
  // Busca input de tipo text/email com name contendo "login", "email" ou "usuario"
  const m = html.match(/name="([^"]*(?:login|email|usuario)[^"]*)"/i);
  return m ? m[1] : null;
}
function findSenhaField(html) {
  const m = html.match(/type="password"[^>]*name="([^"]*)"/i)
         || html.match(/name="([^"]*)"[^>]*type="password"/i);
  return m ? m[1] : null;
}
function findBtnEntrar(html) {
  // Botão de submit — pega o name
  const m = html.match(/type="submit"[^>]*name="([^"]*)"/i)
         || html.match(/name="([^"]*)"[^>]*type="submit"/i);
  return m ? m[1] : null;
}

/**
 * Faz login no RI Digital e retorna o cookie de sessão.
 * Armazena em cache por 25 minutos (sessão ASP.NET padrão = 30 min).
 */
let _loginPromise = null;

export async function getSession() {
  if (_sessionCache.cookie && Date.now() < _sessionCache.expiresAt) {
    return _sessionCache.cookie;
  }
  // Serializa logins concorrentes: se já há um em andamento, todos aguardam o
  // MESMO login — evita dois logins paralelos cujos cookies se sobrescrevem.
  if (_loginPromise) return _loginPromise;
  _loginPromise = _doLogin().finally(() => { _loginPromise = null; });
  return _loginPromise;
}

async function _doLogin() {
  const email = process.env.ONR_EMAIL;
  const senha = process.env.ONR_SENHA;
  if (!email || !senha) throw new Error('ONR_EMAIL e ONR_SENHA não configurados');

  // 1. GET da página de login para obter tokens ASP.NET
  const getRes = await fetch(`${BASE}/FAcesso.aspx`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasil/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await getRes.text();
  const initCookie = parseCookies(getRes.headers.get('set-cookie') || '');

  const viewstate          = extractInput(html, '__VIEWSTATE');
  const eventValidation    = extractInput(html, '__EVENTVALIDATION');
  const viewstateGenerator = extractInput(html, '__VIEWSTATEGENERATOR');

  // Nomes de campo vêm do HTML do ONR — valida o formato ASP.NET esperado antes de
  // usar como chave do POST (evita nome forjado se a página vier adulterada).
  const campoOk = (v) => typeof v === 'string' && /^[\w$]+$/.test(v);
  const emailField = (campoOk(findEmailField(html)) && findEmailField(html)) || 'ctl00$cphConteudo$txtLogin';
  const senhaField = (campoOk(findSenhaField(html)) && findSenhaField(html)) || 'ctl00$cphConteudo$txtSenha';
  const btnField   = (campoOk(findBtnEntrar(html))  && findBtnEntrar(html))  || 'ctl00$cphConteudo$btnEntrar';

  const body = new URLSearchParams({
    __VIEWSTATE:          viewstate,
    __EVENTVALIDATION:    eventValidation,
    __VIEWSTATEGENERATOR: viewstateGenerator,
    [emailField]:         email,
    [senhaField]:         senha,
    [btnField]:           'Entrar',
  });

  // 2. POST de login
  const postRes = await fetch(`${BASE}/FAcesso.aspx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':        serializeCookies(initCookie),
      'Origin':        BASE,
      'Referer':       `${BASE}/FAcesso.aspx`,
      'User-Agent':    'Mozilla/5.0 (compatible; BidProBrasil/1.0)',
    },
    body: body.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });

  const setCookie = postRes.headers.get('set-cookie') || '';
  const location  = postRes.headers.get('location') || '';

  // Sucesso = redirecionou para fora da página de login
  const loginOk = (postRes.status === 302 || postRes.status === 301)
    && !location.toLowerCase().includes('facesso')
    && !location.toLowerCase().includes('erro');

  if (!loginOk) {
    // Tenta extrair mensagem de erro do HTML (resposta 200 = ainda na página de login)
    const errHtml = postRes.status === 200 ? await postRes.text() : '';
    const errMsg  = errHtml.match(/class="[^"]*(?:erro|alert|mensagem)[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim()
                 || 'Credenciais inválidas ou formato de login alterado';
    throw new Error(`ONR login falhou: ${errMsg}`);
  }

  // 3. Consolida todos os cookies (initCookie + Set-Cookie do POST)
  const loginCookies = { ...initCookie, ...parseCookies(setCookie) };
  const cookieStr    = serializeCookies(loginCookies);

  // Cache por 25 min
  _sessionCache = { cookie: cookieStr, expiresAt: Date.now() + 25 * 60 * 1000 };
  return cookieStr;
}

/** Chama um método AJAX do RI Digital (autenticado ou não). */
export async function onrAjax(handler, method, payload = {}, requireSession = true) {
  const sessionCookie = requireSession ? await getSession() : '';
  const url = `${AJAX}/${handler}.ashx?_method=${method}&_session=${requireSession ? 'yes' : 'no'}`;

  const body = new URLSearchParams(
    Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE,
      'Referer': `${BASE}/eProtocolo/listagem_contratos.aspx`,
      'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasil/1.0)',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** Invalida o cache de sessão (ex: ao detectar erro 401/redirect). */
export function invalidateSession() {
  _sessionCache = { cookie: null, expiresAt: 0 };
}

// ─── Helpers de cookie ───────────────────────────────────────────────────────
function parseCookies(raw) {
  const map = {};
  if (!raw) return map;
  // Set-Cookie pode ter múltiplos valores separados por vírgula seguidos de path/expires
  raw.split(/,(?=[^;]+=)/).forEach(part => {
    const kv = part.split(';')[0].trim();
    const [k, ...vs] = kv.split('=');
    if (k) map[k.trim()] = vs.join('=').trim();
  });
  return map;
}
function serializeCookies(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}
