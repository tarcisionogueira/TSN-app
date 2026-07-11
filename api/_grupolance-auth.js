/**
 * Login no Grupo Lance (framework Yii) para capturar os documentos que ficam
 * atrás de login: Matrícula, Auto de avaliação (laudo) e Análise processual.
 *
 * O GL deixa Edital/Processo como PDF PÚBLICO (href direto no CDN), mas serve
 * Matrícula/Laudo/Análise por um endpoint dinâmico:
 *   <a class="doc-link" href="#" data-url="BASE64(/lote/baixar-documento/{id}/file_xxx)">
 * O endpoint /lote/baixar-documento/... só entrega o PDF autenticado (302 → /entrar
 * quando anônimo) e redireciona para a URL final no CDN quando logado.
 *
 * Login (Yii): GET /entrar (cookies GLSESSIONID + _csrf, campo hidden _csrf) →
 * POST /entrar com _csrf + LoginForm[username]/[password]/[rememberMe] → 302.
 * Credenciais em GL_EMAIL/GL_SENHA (com fallback ZUK_EMAIL/ZUK_SENHA — mesmo login).
 */
import { Buffer } from 'buffer';

const BASE = 'https://www.grupolance.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function absorve(jar, resp) {
  let arr = [];
  try { arr = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : []; } catch { arr = []; }
  if (!arr.length) { const raw = resp.headers.get('set-cookie'); if (raw) arr = [raw]; }
  for (const c of arr) { const p = String(c).split(';')[0], i = p.indexOf('='); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
}

// Loga uma vez e devolve o cookie jar autenticado (para varrer vários lotes).
export async function loginGrupoLance() {
  const email = process.env.GL_EMAIL || process.env.ZUK_EMAIL;
  const senha = process.env.GL_SENHA || process.env.ZUK_SENHA;
  if (!email || !senha) { console.log('[gl-auth] GL_EMAIL/GL_SENHA (nem ZUK_*) presentes'); return null; }
  const jar = {};
  const T = 15000;
  try {
    // Aquece a sessão (a 1ª batida fria em /entrar às vezes não traz o form — o Yii
    // só monta o formulário depois de um cookie de sessão). GET / primeiro.
    try {
      const w = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(T) });
      absorve(jar, w);
    } catch { /* segue mesmo se o warm-up falhar */ }

    // GET /entrar com os cookies do warm-up; tenta até achar o _csrf (2 tentativas).
    let csrf = null, status = 0, tam = 0;
    for (let i = 0; i < 2 && !csrf; i++) {
      const g = await fetch(`${BASE}/entrar`, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: jarHeader(jar) }, redirect: 'follow', signal: AbortSignal.timeout(T) });
      absorve(jar, g);
      const html = await g.text();
      status = g.status; tam = html.length;
      csrf = (html.match(/name=["']_csrf["'][^>]*value=["']([^"']+)["']/i)
        || html.match(/value=["']([^"']+)["'][^>]*name=["']_csrf["']/i)
        || html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i) || [])[1];
      if (!csrf) await new Promise(s => setTimeout(s, 700));
    }
    if (!csrf) { console.log(`[gl-auth] _csrf não encontrado (status=${status} htmlLen=${tam} cookies=[${Object.keys(jar).join(',')}])`); return null; }
    const form = new URLSearchParams();
    form.set('_csrf', csrf);
    form.set('LoginForm[username]', email);
    form.set('LoginForm[password]', senha);
    form.set('LoginForm[rememberMe]', '1');
    const p = await fetch(`${BASE}/entrar`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: `${BASE}/entrar`, Cookie: jarHeader(jar) },
      body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(T),
    });
    absorve(jar, p);
    // Yii responde 302 no sucesso; 200 (re-render do form) = credencial inválida.
    if (![301, 302, 303].includes(p.status)) { console.log(`[gl-auth] login falhou (status ${p.status})`); return null; }
    return jar;
  } catch (e) { console.warn(`[gl-auth] login erro ${e?.message}`); return null; }
}

// Classifica o tipo do documento pelo rótulo da âncora e/ou nome do arquivo.
export function classificarDoc(rotulo, url) {
  const t = `${rotulo || ''} ${url || ''}`;
  if (/matr[ií]cul/i.test(t)) return 'matricula';
  if (/laudo|avalia[çc]/i.test(t)) return 'laudo';
  if (/edital/i.test(t)) return 'edital';
  if (/regras|condi[cç][oõ]es/i.test(t)) return 'regras';
  return 'anexo'; // processo, análise processual, memorial, etc.
}

// Abre uma sessão ANÔNIMA (não logada) só para ganhar o cookie GLSESSIONID — a
// página do lote só renderiza os .doc-link com um cookie de sessão presente.
export async function sessaoAnonima() {
  const jar = {};
  try {
    const g = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    absorve(jar, g);
  } catch { /* segue mesmo sem cookie */ }
  return jar;
}

// Resolve o endpoint gated (/lote/baixar-documento/...) até a URL final do CDN,
// SEM baixar o corpo (redirect manual) — leve para docs grandes (ex.: 42 MB).
export async function resolverDocUrl(url, jar, referer) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(jar ? { Cookie: jarHeader(jar) } : {}), ...(referer ? { Referer: referer } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const loc = r.headers.get('location') || '';
    if (/cdn\.grupolance/i.test(loc)) return loc.startsWith('http') ? loc : `https:${loc}`;
    if (/\/entrar/i.test(loc)) return null; // sessão caiu/expirou
    return null;
  } catch { return null; }
}

/**
 * Lê a página do lote (autenticada) e devolve a lista de documentos a baixar.
 * @returns {Promise<Array<{url:string, gated:boolean, rotulo:string|null, tipo:string}>>}
 */
export async function coletarDocsGrupoLance(loteUrl, sessJar) {
  if (!loteUrl) return [];
  // IMPORTANTE: lê a página com uma sessão NÃO-AUTENTICADA (sessJar de sessaoAnonima).
  // Logado, o GL não renderiza os .doc-link (o botão vira outra coisa); com uma sessão
  // anônima "aquecida" o data-url base64 do endpoint está sempre lá. O download depois
  // é que usa a sessão AUTENTICADA (baixarDoc/resolverDocUrl). Retry p/ robustez.
  let html = '';
  for (let i = 0; i < 3 && !/doc-link|cdn\.grupolance/i.test(html); i++) {
    try {
      const g = await fetch(loteUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(sessJar ? { Cookie: jarHeader(sessJar) } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (sessJar) absorve(sessJar, g);
      html = await g.text();
    } catch { html = html || ''; }
    if (!/doc-link|cdn\.grupolance/i.test(html)) await new Promise(s => setTimeout(s, 700));
  }
  const docs = [];
  const vistos = new Set();

  // 1) PDFs públicos diretos no CDN (Edital, Processo, …).
  for (const m of html.matchAll(/\/\/cdn\.grupolance\.com\.br\/[^"'\s)]+\.pdf[^"'\s)]*/gi)) {
    const url = `https:${m[0]}`;
    if (vistos.has(url)) continue; vistos.add(url);
    docs.push({ url, gated: false, rotulo: null, tipo: classificarDoc(null, url) });
  }

  // 2) Docs gated: <a class="...doc-link..."> com data-url base64 → endpoint autenticado.
  for (const a of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = a[0];
    if (!/doc-link/i.test(tag)) continue;
    const du = (tag.match(/data-url=["']([^"']+)["']/i) || [])[1];
    if (!du) continue;
    let path = ''; try { path = Buffer.from(du, 'base64').toString('utf8'); } catch { path = ''; }
    if (!/^\/lote\/baixar-documento\//i.test(path)) continue;
    const url = `${BASE}${path}`;
    if (vistos.has(url)) continue; vistos.add(url);
    const rotulo = a[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    docs.push({ url, gated: true, rotulo, tipo: classificarDoc(rotulo, path) });
  }
  return docs;
}

/**
 * Baixa um documento (público ou gated) usando o jar autenticado; segue o redirect
 * para o CDN. Devolve o buffer, a URL final no CDN e se é PDF.
 */
export async function baixarDoc(url, jar, referer) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', ...(jar ? { Cookie: jarHeader(jar) } : {}), ...(referer ? { Referer: referer } : {}) },
    redirect: 'follow', signal: AbortSignal.timeout(60000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const ehPdf = buf.length > 800 && buf.slice(0, 5).toString('latin1') === '%PDF-';
  return { status: r.status, buffer: buf, finalUrl: r.url || url, ehPdf, contentType: r.headers.get('content-type') || '' };
}

export { BASE as GL_BASE, UA as GL_UA };
