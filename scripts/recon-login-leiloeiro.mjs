/**
 * RECON de LOGIN adaptativo por leiloeiro — valida credencial e descobre como logar
 * e como os documentos aparecem autenticado. Serve GRUPOLANCE, SODRE, FRAZAO, etc.
 *
 * Passos:
 *  1) Confere se <FONTE>_EMAIL / <FONTE>_SENHA estão presentes (nunca imprime o valor).
 *  2) Procura o formulário de login (varre rotas comuns) e descreve: action, método,
 *     campos, framework (_token=Laravel / _csrf=Yii / csrf-token meta).
 *  3) Tenta logar de forma ADAPTATIVA: reaproveita todos os hidden do form (token/csrf),
 *     preenche o campo de usuário (email/cpf/login) e o de senha, e faz POST no action.
 *  4) Autenticado, abre um lote de amostra e reporta o que aparece: PDFs, doc-links
 *     gated (data-url base64), parede de login, e o que o vasculharDocumentos captura.
 * NÃO grava nada. Roda no GitHub Actions. Config: RL_FONTE (ex.: SODRE), RL_N (default 3).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { vasculharDocumentos } from '../api/_doc-scan.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const FONTE = (process.env.RL_FONTE || '').toUpperCase();
const N = Number(process.env.RL_N || 3);

const BASES = {
  GRUPOLANCE: 'https://www.grupolance.com.br',
  SODRE: 'https://www.sodresantoro.com.br',
  FRAZAO: 'https://www.frazaoleiloes.com.br',
  MEGA: 'https://www.megaleiloes.com.br',
  BIASI: 'https://www.biasileiloes.com.br',
};
const CRED_PREFIX = { GRUPOLANCE: 'GL' }; // GL usa GL_EMAIL/GL_SENHA; demais usam <FONTE>_*
function creds(fonte) {
  const p = CRED_PREFIX[fonte] || fonte;
  return { email: process.env[`${p}_EMAIL`], senha: process.env[`${p}_SENHA`], prefix: p };
}

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
  return { status: r.status, url: r.url, html: await r.text() };
}

// Extrai forms com campo de senha; devolve action/method/inputs(name,type,value?).
function formsDeLogin(html) {
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
  const out = [];
  for (const f of forms) {
    const bloco = f[0];
    if (!/type=["']?password/i.test(bloco)) continue;
    const action = (bloco.match(/<form[^>]*\baction=["']([^"']*)["']/i) || [])[1] || '';
    const method = ((bloco.match(/<form[^>]*\bmethod=["']([^"']*)["']/i) || [])[1] || 'GET').toUpperCase();
    const inputs = [...bloco.matchAll(/<input\b[^>]*>/gi)].map(i => ({
      name: (i[0].match(/\bname=["']([^"']*)["']/i) || [])[1] || '',
      type: (i[0].match(/\btype=["']([^"']*)["']/i) || [])[1] || 'text',
      value: (i[0].match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '',
    })).filter(x => x.name);
    out.push({ action, method, inputs });
  }
  return out;
}

async function tentarLogin(base, form, email, senha, refererUrl, jar) {
  // Monta o corpo a partir dos inputs do form: mantém hidden (token/csrf), preenche user/senha.
  const body = new URLSearchParams();
  let userField = null, passField = null;
  for (const inp of form.inputs) {
    if (inp.type === 'password') { passField = inp.name; continue; }
    if (!userField && /e-?mail|usuario|username|login|cpf|user|documento/i.test(inp.name)) { userField = inp.name; continue; }
    if (inp.value) body.set(inp.name, inp.value); // hidden (token/_csrf/etc.)
  }
  // fallback: se não achou userField, usa o 1º input não-hidden não-senha
  if (!userField) { const c = form.inputs.find(i => !['hidden', 'password', 'checkbox', 'submit'].includes(i.type)); userField = c?.name; }
  if (!userField || !passField) return { ok: false, motivo: `campos não identificados (user=${userField} pass=${passField})` };
  body.set(userField, email); body.set(passField, senha);
  // rememberMe se existir
  const rm = form.inputs.find(i => /remember|lembrar/i.test(i.name)); if (rm) body.set(rm.name, '1');
  const actionUrl = form.action ? new URL(form.action, base).href : refererUrl;
  const p = await fetch(actionUrl, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Referer: refererUrl, Cookie: jarHeader(jar) },
    body: body.toString(), redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  absorve(jar, p);
  return { ok: [301, 302, 303].includes(p.status), status: p.status, loc: p.headers.get('location') || '', actionUrl, userField, passField };
}

async function main() {
  if (!FONTE || !BASES[FONTE]) { console.error(`Defina RL_FONTE válido. Bases: ${Object.keys(BASES).join(', ')}`); process.exit(1); }
  const BASE = BASES[FONTE];
  const { email, senha, prefix } = creds(FONTE);
  console.log(`\n🔐 Recon de login ${FONTE} (${BASE})`);
  console.log(`Credenciais ${prefix}_EMAIL/${prefix}_SENHA: ${email ? 'PRESENTE' : 'AUSENTE'} / ${senha ? 'PRESENTE' : 'AUSENTE'}`);
  if (!email || !senha) { console.log('=> Cadastre os secrets antes de validar o login.'); return; }

  // 1) achar o form de login
  const jar = {};
  const rotas = ['/entrar', '/login', '/acessar', '/minha-conta', '/cliente/login', '/conta/login', '/usuario/login', '/'];
  let form = null, paginaLogin = null;
  for (const rota of rotas) {
    try {
      const r = await get(BASE + rota, jar);
      const fs = formsDeLogin(r.html);
      const framework = /name=["']_csrf["']/i.test(r.html) ? 'Yii(_csrf)' : /name=["']_token["']/i.test(r.html) ? 'Laravel(_token)' : /csrf-token/i.test(r.html) ? 'meta csrf-token' : '?';
      console.log(`  [${rota}] status=${r.status} forms-login=${fs.length} framework=${framework}`);
      fs.forEach(f => console.log(`      action="${f.action}" ${f.method} campos=[${f.inputs.map(i => `${i.name}(${i.type})`).join(', ')}]`));
      if (fs.length && !form) { form = fs[0]; paginaLogin = r.url; }
    } catch (e) { console.log(`  [${rota}] ERRO ${e.message}`); }
  }
  if (!form) { console.log('=> Nenhum formulário de login encontrado nas rotas testadas.'); return; }

  // 2) tentar login
  const res = await tentarLogin(BASE, form, email, senha, paginaLogin, jar);
  console.log(`\n  Login: ${res.ok ? 'OK (redirect)' : 'sem redirect'} status=${res.status} → ${res.loc} (user=${res.userField} pass=${res.passField})`);
  const home = await get(`${BASE}/`, jar);
  const logado = /sair|logout|minha[- ]?conta|meus[- ]?lances|ol[áa],|bem[- ]?vindo/i.test(home.html);
  console.log(`  Sessão (heurística home): ${logado}  cookies=[${Object.keys(jar).join(', ')}]`);

  // 3) abrir lotes de amostra autenticado e reportar documentos
  const { data: lotes } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital, link_foto')
    .eq('fonte', FONTE).eq('ativo', true).limit(50);
  const alvos = (lotes || []).map(l => ({ ...l, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, N);
  console.log(`\n  Amostra de ${alvos.length} lote(s) autenticado:`);
  for (const l of alvos) {
    try {
      const r = await get(l.page, jar);
      const docs = vasculharDocumentos(r.html, l.page, l.link_foto || null);
      const pdfs = [...r.html.matchAll(/https?:(?:\\\/|\/)[^"'\\\s)]+\.pdf[^"'\\\s)]*/gi)].length;
      const gated = [...r.html.matchAll(/data-url=["'][A-Za-z0-9+/=]{12,}["']/gi)].map(m => (m[0].match(/data-url=["']([^"']+)["']/i) || [])[1]);
      const loginWall = /(fazer|efetuar)\s*login|acesse sua conta|entrar para (ver|baixar)/i.test(r.html);
      console.log(`   ${l.fonte_id} status=${r.status} pdfs=${pdfs} gatedLinks=${gated.length} loginWall=${loginWall} → vasculhador anexos=${docs.anexos.length} [${docs.anexos.map(a => a.tipo).join(',')}]`);
      gated.slice(0, 4).forEach(g => { let p = ''; try { p = Buffer.from(g, 'base64').toString('utf8'); } catch { p = '(n/d)'; } console.log(`       gated data-url → ${p.slice(0, 90)}`); });
      docs.anexos.slice(0, 5).forEach(a => console.log(`       [${a.tipo}] ${String(a.nome).slice(0, 36)} → ${String(a.url).slice(0, 100)}`));
    } catch (e) { console.log(`   ${l.fonte_id} ERRO ${e.message}`); }
  }
  console.log('\nFim do recon de login.');
}

main().catch((e) => { console.error(e); process.exit(1); });
