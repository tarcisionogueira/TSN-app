/**
 * POST /api/anunciar-produto — o ADMIN dispara, do cadastro do produto, um e-mail de
 * APRESENTAÇÃO de um ebook/curso para a base de clientes. O e-mail leva um botão que
 * abre a PÁGINA do produto (/#/p/<tipo>/<id>) com os botões de aquisição.
 *
 * Reuso do que já temos: _email.js (Resend + emails_log), o opt-out de alertas
 * (alertas_email.ativo=false) e o token de descadastro one-click (assinarUnsub).
 *
 * Segurança: só admin (getAuthUser + getUserRoleById). Público = CLIENTES
 * (explorador/top2/top2_anual/assessorado/clube) — NUNCA equipe/admin (evita nudar o
 * próprio time, bug conhecido de cron sem excluir contas internas). Respeita opt-out.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getAuthUser, unauthorized, forbidden, getUserRoleById } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { escapeHtml } from './_sanitize.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

// Só CLIENTES recebem o anúncio (nunca equipe/admin).
const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'clube'];
const CAP = 3000; // teto de segurança por disparo (a base hoje é pequena; evita runaway)

const hdr = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN },
});
const sbGet = async (path) => {
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.json() : []; }
  catch { return []; }
};

const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => escapeHtml(String(s ?? ''));

// Capa p/ e-mail: só URL http(s) direta (bucket público membros-capas). Drive/relativa → sem imagem.
function capaEmail(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) && !/drive\.google\.com/i.test(u) ? u : null;
}

function corpoEmail({ tipo, produto, nome }) {
  const rotulo = tipo === 'curso' ? 'curso' : 'eBook';
  const link = `${BASE}/#/p/${tipo}/${produto.id}`;
  const isPago = Number(produto.preco || 0) > 0;
  const preco = isPago ? fmtBRL(produto.preco) : 'Incluído no plano Investidor Pro';
  const capa = capaEmail(produto.capa_url);
  const desc = String(produto.descricao || '').slice(0, 320);
  const cor = produto.cor || '#0D63DB';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <a href="${BASE}/#/membros" style="text-decoration:none;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:22px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
    </div>
  </a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:11px;font-weight:800;color:${esc(cor)};text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Novidade · ${rotulo}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;line-height:1.3;">${esc(produto.titulo || 'Novo material')}</h2>
    ${nome ? `<p style="margin:0 0 14px;color:#475569;font-size:14px;">Olá, ${esc(String(nome).split(' ')[0])}! Acabamos de disponibilizar este ${rotulo} na plataforma.</p>` : ''}
    ${capa ? `<a href="${link}"><img src="${esc(capa)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:18px;display:block;"></a>` : ''}
    ${desc ? `<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.7;">${esc(desc)}${produto.descricao && produto.descricao.length > 320 ? '…' : ''}</p>` : ''}
    <div style="font-size:13px;color:#64748b;margin-bottom:18px;">${isPago ? `<strong style="color:#0f172a;font-size:18px;">${preco}</strong>` : `<strong style="color:#0f172a;">${preco}</strong>`}</div>
    <div style="text-align:center;margin:8px 0 6px;">
      <a href="${link}" style="display:inline-block;background:${esc(cor)};color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:800;font-size:15px;">
        ${isPago ? `Ver e adquirir →` : `Acessar agora →`}
      </a>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:22px;">BidPro Brasil · Novidades da plataforma · <a href="{{UNSUB}}" style="color:#94a3b8;">Cancelar e-mails</a></p>
  </div>
</div></body></html>`;
}

// E-mails do lote (auth.users via GoTrue admin), concorrência limitada.
async function emailsDoLote(ids) {
  const map = new Map(); const CONC = 8;
  for (let i = 0; i < ids.length; i += CONC) {
    const res = await Promise.all(ids.slice(i, i + CONC).map(async (uid) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        if (!r.ok) return null;
        const u = await r.json();
        return u?.email ? [uid, String(u.email).toLowerCase()] : null;
      } catch { return null; }
    }));
    for (const e of res) if (e) map.set(e[0], e[1]);
  }
  return map;
}

// SOMENTE export nomeado (POST): no runtime Node da Vercel, `export default` é tratado
// como assinatura Express (req,res) e o `Response` retornado é IGNORADO → 504.
export const POST = handler;
async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SVC) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user?.id) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();

  let body = {};
  try { body = await req.json(); } catch { /* corpo inválido */ }
  const tipo = body?.tipo === 'curso' ? 'curso' : 'ebook';
  const id = String(body?.id || '').trim();
  if (!id) return json({ error: 'Produto não informado' }, 400);

  // Carrega o produto (metadados p/ o e-mail).
  const tabela = tipo === 'curso' ? 'cursos_admin' : 'ebooks_admin';
  const prodArr = await sbGet(`${tabela}?id=eq.${encodeURIComponent(id)}&select=id,titulo,descricao,capa_url,preco${tipo === 'curso' ? ',cor' : ''}&limit=1`);
  const produto = Array.isArray(prodArr) ? prodArr[0] : null;
  if (!produto) return json({ error: 'Produto não encontrado' }, 404);

  // Destinatários: CLIENTES ativos (nunca equipe/admin).
  const perfis = await sbGet(`perfis?select=id,nome&role=in.(${ROLES_CLIENTE.join(',')})&ativo=eq.true&order=id.asc&limit=${CAP}`);
  const ids = (Array.isArray(perfis) ? perfis : []).map((p) => p.id).filter(Boolean);
  if (!ids.length) return json({ ok: true, enviados: 0, destinatarios: 0, motivo: 'sem clientes' });

  // Opt-out (mesmo sinal dos alertas): quem descadastrou não recebe. Busca a lista de
  // descadastrados direto (é pequena) — evita montar um in.(...) gigante de UUIDs na URL.
  const optArr = await sbGet(`alertas_email?ativo=eq.false&select=user_id`);
  const optOut = new Set((Array.isArray(optArr) ? optArr : []).map((o) => o.user_id));

  const alvos = (Array.isArray(perfis) ? perfis : []).filter((p) => !optOut.has(p.id));
  const emailMap = await emailsDoLote(alvos.map((p) => p.id));

  const rotulo = tipo === 'curso' ? 'curso' : 'eBook';
  const assunto = `📚 Novo ${rotulo} na BidPro: ${produto.titulo || ''}`.trim().slice(0, 120);

  let enviados = 0, falhas = 0, semEmail = 0;
  const CONC = 5; // Resend: ritmo tranquilo
  const lista = alvos.filter((p) => emailMap.has(p.id));
  semEmail = alvos.length - lista.length;

  for (let i = 0; i < lista.length; i += CONC) {
    const chunk = lista.slice(i, i + CONC);
    const res = await Promise.all(chunk.map(async (p) => {
      const email = emailMap.get(p.id);
      const html = corpoEmail({ tipo, produto, nome: p.nome }).replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(p.id)}`);
      const r = await enviarEmail({ from: FROM, to: email, subject: assunto, html, meta: { tipo: 'anuncio_produto', userId: p.id } });
      return !!r?.ok;
    }));
    for (const ok of res) { if (ok) enviados++; else falhas++; }
  }

  return json({ ok: true, tipo, produto: produto.titulo, destinatarios: alvos.length, enviados, falhas, sem_email: semEmail });
}
