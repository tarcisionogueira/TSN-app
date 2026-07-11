/**
 * RECON de LOGIN — Grupo Lance (molde ZUK): descobrir como logar e baixar os docs
 * que ficam atrás de login (Matrícula, Auto de avaliação, Análise processual).
 *
 * A sonda anterior provou que Edital/Processo são PDFs públicos (href direto no CDN),
 * mas Matrícula/Auto de avaliação/Análise processual vêm como
 *   <a class="doc-link" href="#" data-url="BASE64(/lote/baixar-documento/{id}/file_xxx)">
 * e o endpoint /lote/baixar-documento/... só entrega o PDF autenticado.
 *
 * Este recon NÃO grava nada. Ele:
 *   1) Acha o formulário de login (varre /login, /entrar, /minha-conta e a home):
 *      action, method, campos e se tem _token (Laravel).
 *   2) Enumera, num lote real, TODOS os data-url (base64) dos .doc-link → tipos de arquivo.
 *   3) Testa o endpoint /lote/baixar-documento/{id}/file_registration ANÔNIMO (baseline).
 *   4) Se GL_EMAIL/GL_SENHA (ou ZUK_EMAIL/ZUK_SENHA) existirem: tenta logar e baixar
 *      a matrícula do lote de teste, reportando status + se veio %PDF-.
 * Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY (para pegar um lote), e as credenciais.
 * Config: GL_TEST_ID (fonte_id sem 'gl_', default 27183).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BASE = 'https://www.grupolance.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TEST_ID = String(process.env.GL_TEST_ID || '27183');
const EMAIL = process.env.GL_EMAIL || process.env.ZUK_EMAIL;
const SENHA = process.env.GL_SENHA || process.env.ZUK_SENHA;

const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function absorve(jar, resp) {
  let arr = [];
  try { arr = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : []; } catch { arr = []; }
  if (!arr.length) { const raw = resp.headers.get('set-cookie'); if (raw) arr = [raw]; }
  for (const c of arr) { const p = String(c).split(';')[0], i = p.indexOf('='); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
}
async function get(url, jar) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(jar ? { Cookie: jarHeader(jar) } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (jar) absorve(jar, r);
  return { status: r.status, url: r.url, html: await r.text(), headers: r.headers };
}

// Descreve os <form> que contêm campo de senha (candidatos a login).
function acharFormsLogin(html, origem) {
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
  const out = [];
  for (const f of forms) {
    const bloco = f[0];
    if (!/type=["']?password/i.test(bloco)) continue;
    const action = (bloco.match(/<form[^>]*\baction=["']([^"']*)["']/i) || [])[1] || '(sem action)';
    const method = (bloco.match(/<form[^>]*\bmethod=["']([^"']*)["']/i) || [])[1] || 'GET';
    const inputs = [...bloco.matchAll(/<input\b[^>]*>/gi)].map(i => {
      const name = (i[0].match(/\bname=["']([^"']*)["']/i) || [])[1];
      const type = (i[0].match(/\btype=["']([^"']*)["']/i) || [])[1] || 'text';
      return name ? `${name}(${type})` : null;
    }).filter(Boolean);
    const temToken = /name=["']_token["']/i.test(bloco);
    out.push({ origem, action, method, temToken, inputs });
  }
  return out;
}

async function main() {
  console.log(`Recon de login do Grupo Lance — lote de teste gl_${TEST_ID}\n`);
  console.log(`Credenciais presentes: EMAIL=${EMAIL ? 'sim' : 'NÃO'} SENHA=${SENHA ? 'sim' : 'NÃO'}\n`);

  // 1) Procurar o formulário de login em várias rotas comuns.
  const rotas = ['/login', '/entrar', '/minha-conta', '/cliente/login', '/'];
  const jar = {};
  let paginaComToken = null, tokenGlobal = null;
  for (const rota of rotas) {
    try {
      const r = await get(BASE + rota, jar);
      const forms = acharFormsLogin(r.html, rota);
      const token = (r.html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i) || [])[1]
        || (r.html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i) || [])[1];
      console.log(`[${rota}] status=${r.status} finalUrl=${r.url} forms-login=${forms.length} _token=${token ? 'sim' : 'não'}`);
      forms.forEach(f => console.log(`    form action="${f.action}" method=${f.method} _token=${f.temToken} campos=[${f.inputs.join(', ')}]`));
      if (token && !tokenGlobal) { tokenGlobal = token; paginaComToken = BASE + rota; }
    } catch (e) { console.log(`[${rota}] ERRO ${e.message}`); }
  }

  // 2) Enumerar os data-url (base64) dos .doc-link no lote de teste.
  let loteUrl = null;
  const { data } = await supabase.from('imoveis_leilao').select('url_lote').eq('fonte_id', `gl_${TEST_ID}`).limit(1);
  loteUrl = data?.[0]?.url_lote;
  console.log(`\nLote de teste: ${loteUrl || '(não achado no banco)'}`);
  if (loteUrl) {
    const r = await get(loteUrl, jar);
    const docLinks = [...r.html.matchAll(/<a\b[^>]*class=["'][^"']*doc-link[^"']*["'][^>]*data-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    console.log(`  .doc-link (login-gated): ${docLinks.length}`);
    for (const d of docLinks) {
      let path = ''; try { path = Buffer.from(d[1], 'base64').toString('utf8'); } catch { path = '(base64 inválido)'; }
      const rotulo = d[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`     · "${rotulo}" → ${path}`);
    }
    const publicos = [...r.html.matchAll(/\/\/cdn\.grupolance\.com\.br\/[^"'\s)]+\.pdf[^"'\s)]*/gi)].map(m => m[0]);
    console.log(`  PDFs públicos diretos: ${publicos.length}`);
    publicos.slice(0, 6).forEach(u => console.log(`     · ${u}`));
  }

  // 3) Baseline anônimo do endpoint gated.
  const endpoint = `${BASE}/lote/baixar-documento/${TEST_ID}/file_registration`;
  try {
    const r = await fetch(endpoint, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const loc = r.headers.get('location') || '';
    console.log(`\n[anônimo] GET ${endpoint} → status=${r.status} ${loc ? '→ ' + loc : ''}`);
  } catch (e) { console.log(`\n[anônimo] ERRO ${e.message}`); }

  // 4) Tentar login e baixar a matrícula autenticado.
  if (EMAIL && SENHA && tokenGlobal && paginaComToken) {
    console.log(`\n── Tentando login (form Laravel) via _token de ${paginaComToken} ──`);
    for (const actionUrl of [`${BASE}/login`, `${BASE}/entrar`, `${BASE}/minha-conta/login`]) {
      try {
        const form = new URLSearchParams({ _token: tokenGlobal, email: EMAIL, password: SENHA });
        const p = await fetch(actionUrl, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: paginaComToken, Cookie: jarHeader(jar) },
          body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(20000),
        });
        absorve(jar, p);
        console.log(`  POST ${actionUrl} → status=${p.status} loc=${p.headers.get('location') || ''}`);
        if ([301, 302, 303].includes(p.status)) {
          // valida sessão + baixa matrícula
          const dl = await fetch(endpoint, { headers: { 'User-Agent': UA, Cookie: jarHeader(jar), Referer: loteUrl || BASE }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
          const buf = Buffer.from(await dl.arrayBuffer());
          const ehPdf = buf.slice(0, 5).toString('latin1') === '%PDF-';
          console.log(`  ⇒ download matrícula: status=${dl.status} ${Math.round(buf.length / 1024)}kb PDF=${ehPdf} ct=${dl.headers.get('content-type')}`);
          if (ehPdf) { console.log('  ✅ LOGIN OK e matrícula baixada — molde confirmado.'); break; }
        }
      } catch (e) { console.log(`  POST ${actionUrl} ERRO ${e.message}`); }
    }
  } else {
    console.log('\n(login não tentado — faltam credenciais ou _token)');
  }
  console.log('\nFim do recon de login.');
}

main().catch((e) => { console.error(e); process.exit(1); });
