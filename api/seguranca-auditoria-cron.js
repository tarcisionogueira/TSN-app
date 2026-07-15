/**
 * /api/seguranca-auditoria-cron — o "bug bounty" embutido na saúde do sistema.
 *
 * Roda a bateria determinística auditoria_seguranca() no banco (postura de RLS,
 * grants de RPC, buckets, triggers) e DETECTA REGRESSÕES: se qualquer brecha que
 * fechamos reabrir (ex.: um RPC de admin voltar a ser executável por anon, o bucket
 * documentos voltar a ser público, a trigger anti-escalação sumir), o admin é avisado
 * por e-mail NA HORA. Guarda histórico em seguranca_auditoria para a tela de saúde.
 *
 * Silencioso quando está tudo limpo (não spamma). Roda 1x/dia (vercel.json).
 * NÃO substitui um pentest ao vivo com humanos — é a rede sempre-ligada entre eles.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const EMAIL_FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();

function sb(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB_URL || !SB_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  // 1) Roda o auditor determinístico no banco (SECURITY DEFINER, só service_role).
  let rel = null;
  try {
    const r = await sb('rpc/auditoria_seguranca', { method: 'POST', body: '{}', signal: AbortSignal.timeout(20000) });
    if (r.ok) rel = await r.json();
  } catch { /* rede/timeout */ }
  if (!rel || typeof rel !== 'object') {
    return new Response(JSON.stringify({ error: 'Falha ao executar auditoria' }), { status: 502 });
  }

  const criticos = Number(rel.criticos || 0);
  const atencao  = Number(rel.atencao || 0);
  const achados  = Array.isArray(rel.achados) ? rel.achados : [];

  // 2) Histórico (tela de saúde do sistema lê o mais recente).
  try {
    await sb('seguranca_auditoria', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ total: rel.total || 0, criticos, atencao, achados }),
    });
  } catch { /* best-effort */ }

  // 3) Alerta o admin SÓ quando há regressão (crítico/atenção). Silêncio quando limpo.
  if ((criticos + atencao) > 0 && ADMIN_EMAIL) {
    const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const linhas = achados.map((a) =>
      `<li><strong>[${esc(String(a.severidade).toUpperCase())}]</strong> ${esc(a.check)}: ${esc(a.detalhe)}${Array.isArray(a.itens) && a.itens.length ? ` — ${esc(a.itens.join(', '))}` : ''}</li>`
    ).join('');
    try {
      await enviarEmail({
        from: EMAIL_FROM, to: ADMIN_EMAIL,
        subject: `🛡️ Auditoria de segurança — ${criticos} crítico(s), ${atencao} atenção`,
        html: `<p>A auditoria automática detectou uma mudança na postura de segurança do BidPro Brasil:</p><ul>${linhas}</ul><p>Verifique se foi uma alteração intencional ou uma regressão a corrigir.</p>`,
      });
    } catch { /* não bloqueia a resposta */ }
  }

  return new Response(JSON.stringify({ ok: true, criticos, atencao, total: rel.total || 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
