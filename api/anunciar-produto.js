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
import { corpoEmailProduto, emailsDoLote } from './_produto-email.js';

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


// O template do e-mail e a busca de e-mails vivem em `_produto-email.js`, compartilhados
// com /api/divulgacao-cron (a divulgacao quinzenal). Duas copias do HTML divergiriam na
// primeira melhoria feita em uma so.

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
      const html = corpoEmailProduto({ tipo, produto, nome: p.nome, contexto: 'novidade' }).replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(p.id)}`);
      const r = await enviarEmail({ from: FROM, to: email, subject: assunto, html, meta: { tipo: 'anuncio_produto', userId: p.id } });
      return !!r?.ok;
    }));
    for (const ok of res) { if (ok) enviados++; else falhas++; }
  }

  return json({ ok: true, tipo, produto: produto.titulo, destinatarios: alvos.length, enviados, falhas, sem_email: semEmail });
}
