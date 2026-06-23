/**
 * Helper de autenticação e chamadas ao RI Digital (ridigital.org.br).
 * Sistema: ASP.NET WebForms + ASHX handlers via cookie de sessão.
 *
 * Fluxo:
 * 1. GET /Acesso.aspx → extrai __VIEWSTATE, __EVENTVALIDATION, __VIEWSTATEGENERATOR
 * 2. POST /Acesso.aspx com credenciais (senha em SHA-1) → 302 → cookie de sessão
 * 3. Chamadas autenticadas: POST /ajax/{handler}.ashx?_method={method}&_session=yes
 *
 * Campos confirmados via DevTools (23/06/2026):
 *   txtEmail, txtSenha (SHA-1 do plaintext), btnProsseguir
 */

const BASE = 'https://ridigital.org.br';
const AJAX = `${BASE}/ajax`;

// Cache em memória (por instância da função serverless)
let _sessionCache = { cookie: null, expiresAt: 0 };

/** SHA-1 da senha — o site faz isso no cliente antes de enviar */
async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Extrai o valor de um input hidden do HTML por nome */
function extractInput(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp(`name="${esc}"[^>]*value="([^"]*)"`, 'i'))
         || html.match(new RegExp(`value="([^"]*)"[^>]*name="${esc}"`, 'i'));
  return m ? m[1] : '';
}

/**
 * Faz login no RI Digital e retorna o cookie de sessão.
 * Armazena em cache por 25 minutos (sessão ASP.NET padrão = 30 min).
 */
export async function getSession() {
  if (_sessionCache.cookie && Date.now() < _sessionCache.expiresAt) {
    return _sessionCache.cookie;
  }

  const email = process.env.ONR_EMAIL;
  const senha = process.env.ONR_SENHA;
  if (!email || !senha) throw new Error('ONR_EMAIL e ONR_SENHA não configurados');

  // 1. GET da página de login para obter tokens ASP.NET
  const getRes = await fetch(`${BASE}/Acesso.aspx`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TSN-App/1.0)' },
  });
  const html = await getRes.text();
  const initCookie = parseCookies(getRes.headers.get('set-cookie') || '');

  const viewstate          = extractInput(html, '__VIEWSTATE');
  const eventValidation    = extractInput(html, '__EVENTVALIDATION');
  const viewstateGenerator = extractInput(html, '__VIEWSTATEGENERATOR');

  // Senha enviada como SHA-1 (confirmado via DevTools)
  const senhaSha1 = await sha1(senha);

  const body = new URLSearchParams({
    __VIEWSTATE:          viewstate,
    __EVENTVALIDATION:    eventValidation,
    __VIEWSTATEGENERATOR: viewstateGenerator,
    txtEmail:             email,
    txtSenha:             senhaSha1,
    btnProsseguir:        'Entrar',
  });

  // 2. POST de login
  const postRes = await fetch(`${BASE}/Acesso.aspx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':        serializeCookies(initCookie),
      'Origin':        BASE,
      'Referer':       `${BASE}/Acesso.aspx`,
      'User-Agent':    'Mozilla/5.0 (compatible; TSN-App/1.0)',
    },
    body: body.toString(),
    redirect: 'manual',
  });

  const setCookie = postRes.headers.get('set-cookie') || '';
  const location  = postRes.headers.get('location') || '';

  // Sucesso = redireciona para ServicosOnline (confirmado via DevTools)
  const loginOk = (postRes.status === 302 || postRes.status === 301)
    && !location.toLowerCase().includes('acesso')
    && !location.toLowerCase().includes('erro');

  if (!loginOk) {
    const errHtml = postRes.status === 200 ? await postRes.text() : '';
    const errMsg  = errHtml.match(/class="[^"]*(?:erro|alert|mensagem)[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim()
                 || `Status ${postRes.status} — credenciais inválidas ou formato alterado`;
    throw new Error(`ONR login falhou: ${errMsg}`);
  }

  // 3. Consolida todos os cookies
  const loginCookies = { ...initCookie, ...parseCookies(setCookie) };
  const cookieStr    = serializeCookies(loginCookies);

  // Cache por 25 min
  _sessionCache = { cookie: cookieStr, expiresAt: Date.now() + 25 * 60 * 1000 };
  return cookieStr;
}

/** Chama um método AJAX do RI Digital. Faz 1 retry automático se sessão expirada. */
export async function onrAjax(handler, method, payload = {}, requireSession = true) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
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
        'User-Agent': 'Mozilla/5.0 (compatible; TSN-App/1.0)',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: body.toString(),
    });

    // Sessão rejeitada pelo servidor → invalida cache e tenta de novo
    if (requireSession && (res.status === 401 || res.redirected || res.url?.includes('Acesso'))) {
      invalidateSession();
      if (tentativa === 0) continue;
      throw new Error('ONR sessão inválida após retry');
    }

    const text = await res.text();

    // Resposta HTML de login = sessão expirou silenciosamente
    if (requireSession && text.includes('txtEmail') && tentativa === 0) {
      invalidateSession();
      continue;
    }

    try { return JSON.parse(text); } catch { return text; }
  }
}

/** Invalida o cache de sessão (ex: ao detectar erro 401/redirect). */
export function invalidateSession() {
  _sessionCache = { cookie: null, expiresAt: 0 };
}

// ─── Helpers de cookie ───────────────────────────────────────────────────────
function parseCookies(raw) {
  const map = {};
  if (!raw) return map;
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
