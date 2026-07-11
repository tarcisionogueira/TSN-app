/**
 * Login on-demand no Portal Zuk (Zukerman) para capturar a MATRÍCULA do lote.
 *
 * O Zuk deixa o EDITAL público (link direto no HTML), mas tranca a MATRÍCULA atrás
 * de login: no HTML anônimo o card da matrícula vem com href="" e abre o modal de
 * login. Só com uma sessão autenticada o servidor injeta a URL assinada do PDF da
 * matrícula na página. Este helper faz, sob demanda (só quando alguém ANALISA um
 * lote do Zuk), o login Laravel padrão e devolve os documentos que só aparecem
 * logado. Credenciais em ZUK_EMAIL / ZUK_SENHA (env do Vercel).
 *
 * Fluxo: GET no lote (pega _token CSRF + cookies de sessão) → POST /login →
 * GET no lote autenticado → vasculha o HTML (reaproveita _doc-scan) → matrícula.
 */
const BASE = 'https://www.portalzuk.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// Cookie jar minimalista (o fetch do Node não persiste cookies entre chamadas).
const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function absorveCookies(jar, resp) {
  let arr = [];
  try { arr = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : []; } catch { arr = []; }
  if (!arr.length) { const raw = resp.headers.get('set-cookie'); if (raw) arr = [raw]; }
  for (const c of arr) {
    const pair = String(c).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}

/**
 * @param {string} loteUrl  URL da página do lote no portalzuk.com.br
 * @param {number} deadline timestamp (ms) limite da requisição de análise
 * @returns {Promise<null | {matricula:string|null, edital:string|null, anexos:Array}>}
 */
export async function capturarDocsZukLogado(loteUrl, deadline) {
  const email = process.env.ZUK_EMAIL, senha = process.env.ZUK_SENHA;
  if (!email || !senha) { console.log('[zuk-auth] ZUK_EMAIL/ZUK_SENHA ausentes'); return null; }
  if (!loteUrl || !/portalzuk\.com\.br\/imovel\//i.test(loteUrl)) return null;
  if (deadline && Date.now() > deadline - 12000) { console.log('[zuk-auth] sem tempo hábil'); return null; }

  const jar = {};
  const T = 12000;
  try {
    // 1) GET no lote → cookies de sessão + _token do formulário de login.
    const g1 = await fetch(loteUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(T) });
    absorveCookies(jar, g1);
    const html1 = await g1.text();
    const token = (html1.match(/name="_token"\s+value="([^"]+)"/i) || [])[1];
    if (!token) { console.log('[zuk-auth] _token não encontrado'); return null; }

    // 2) POST /login (form Laravel). redirect manual p/ preservar cookies da sessão autenticada.
    const form = new URLSearchParams({ _token: token, email, password: senha, user_screen_width: '1280', user_screen_height: '800' });
    const p = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'pt-BR,pt;q=0.9', Origin: BASE, Referer: loteUrl, Cookie: jarHeader(jar) },
      body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(T),
    });
    absorveCookies(jar, p);
    // Laravel responde 302 no sucesso; 200 (re-render do form) costuma ser falha de credencial.
    if (p.status !== 302 && p.status !== 301 && p.status !== 303) console.log(`[zuk-auth] login status inesperado ${p.status} (segue e tenta a página logada)`);

    // 3) GET no lote autenticado → a matrícula agora vem com URL assinada.
    const g2 = await fetch(loteUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: jarHeader(jar) }, redirect: 'follow', signal: AbortSignal.timeout(T) });
    absorveCookies(jar, g2);
    const html2 = await g2.text();

    // Extrai o href REAL dos cards de documento (property-documents-item), já logado.
    // O CloudFront exige a URL ASSINADA (Expires/Signature) — decodificamos &amp; e
    // tiramos os espaços que o Zuk deixa dentro do atributo href.
    const cardHrefs = [...html2.matchAll(/<a[^>]*property-documents-item[^>]*href="([^"]*)"/gi)]
      .map(m => m[1].replace(/&amp;/g, '&').trim())
      .filter(u => /^https?:\/\//.test(u));
    const matricula = cardHrefs.find(u => /matr[ií]cul/i.test(u) && /\.pdf/i.test(u)) || null;
    const laudo = cardHrefs.find(u => /laudo|avalia/i.test(u)) || null;
    const logado = /\/sair|logout|minha-conta\/area-logada|meus-lances|Ol[áa],/i.test(html2);
    console.log(`[zuk-auth] logado=${logado} cards=${cardHrefs.length} matricula=${matricula ? (/Signature=/i.test(matricula) ? 'ASSINADA' : 'sem-assinatura') : 'AUSENTE'} | href: ${(matricula || '(nenhum)').slice(0, 220)}`);
    return { matricula, laudo, anexos: (matricula ? [{ url: matricula, nome: 'Matrícula do Imóvel', tipo: 'matricula' }] : []) };
  } catch (e) {
    console.warn(`[zuk-auth] erro ${e?.message}`);
    return null;
  }
}

// ── LOGIN REUTILIZÁVEL (captura em LOTE no GitHub Actions) ───────────────────
// Loga UMA vez e devolve o cookie jar autenticado, para varrer vários lotes sem
// re-logar. O capturarDocsZukLogado acima (on-demand no Vercel) segue INTOCADO.
// paginaToken: uma URL de lote do Zuk (tem o modal de login com _token).
export async function loginZuk(paginaToken) {
  const email = process.env.ZUK_EMAIL, senha = process.env.ZUK_SENHA;
  if (!email || !senha) { console.log('[zuk-auth] ZUK_EMAIL/ZUK_SENHA ausentes'); return null; }
  const jar = {};
  const T = 12000;
  try {
    const url0 = /portalzuk\.com\.br/i.test(String(paginaToken || '')) ? paginaToken : `${BASE}/`;
    const g0 = await fetch(url0, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(T) });
    absorveCookies(jar, g0);
    const token = ((await g0.text()).match(/name="_token"\s+value="([^"]+)"/i) || [])[1];
    if (!token) { console.log('[zuk-auth] _token não encontrado (login)'); return null; }
    const form = new URLSearchParams({ _token: token, email, password: senha, user_screen_width: '1280', user_screen_height: '800' });
    const p = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'pt-BR,pt;q=0.9', Origin: BASE, Referer: url0, Cookie: jarHeader(jar) },
      body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(T),
    });
    absorveCookies(jar, p);
    if (![301, 302, 303].includes(p.status)) console.log(`[zuk-auth] login status inesperado ${p.status}`);
    return jar;
  } catch (e) { console.warn(`[zuk-auth] login erro ${e?.message}`); return null; }
}

// Extrai a matrícula (URL assinada) de UM lote usando um jar já autenticado.
export async function matriculaLoteLogado(loteUrl, jar) {
  if (!loteUrl || !/portalzuk\.com\.br\/imovel\//i.test(loteUrl) || !jar) return null;
  try {
    const g = await fetch(loteUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: jarHeader(jar) }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    absorveCookies(jar, g);
    const html = await g.text();
    const cardHrefs = [...html.matchAll(/<a[^>]*property-documents-item[^>]*href="([^"]*)"/gi)]
      .map(m => m[1].replace(/&amp;/g, '&').trim())
      .filter(u => /^https?:\/\//.test(u));
    const matricula = cardHrefs.find(u => /matr[ií]cul/i.test(u) && /\.pdf/i.test(u)) || null;
    const laudo = cardHrefs.find(u => /laudo|avalia/i.test(u)) || null;
    return { matricula, laudo, cards: cardHrefs.length };
  } catch (e) { console.warn(`[zuk-auth] lote erro ${e?.message}`); return null; }
}
