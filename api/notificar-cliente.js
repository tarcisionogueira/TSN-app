/**
 * POST /api/notificar-cliente  (equipe)
 * Envia por e-mail ao cliente a resposta do consultor em um chamado — essencial
 * para LEADS sem conta (que não têm como ver o Atendimento). Resend.
 * Body: { chamado_id, mensagem }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const ROLES_STAFF  = ['admin', 'analista', 'advogado', 'consultor'];

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !ROLES_STAFF.includes(perfil.role)) return json({ error: 'Apenas equipe' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { chamado_id, mensagem } = body;
  if (!chamado_id || !String(mensagem || '').trim()) return json({ error: 'chamado_id e mensagem obrigatórios' }, 400);

  const [chamado] = await (await sb(`chamados?id=eq.${encodeURIComponent(chamado_id)}&select=user_email,user_nome,titulo`)).json();
  if (!chamado?.user_email) return json({ ok: true, skipped: 'sem_email' });

  if (!RESEND_KEY) return json({ ok: true, skipped: 'sem_resend' });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
        to: [chamado.user_email],
        reply_to: 'suporte@bidprobrasil.com.br',
        subject: `Resposta da nossa equipe — ${chamado.titulo || 'sua dúvida'}`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2 style="color:#0D63DB">Olá${chamado.user_nome ? ', ' + chamado.user_nome : ''}!</h2>
          <p>Recebemos sua dúvida e aqui está a resposta da nossa equipe:</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:14px 0;white-space:pre-wrap">${String(mensagem).replace(/</g, '&lt;')}</div>
          <p>Se precisar de mais alguma coisa, é só responder este e-mail.</p>
          <p style="margin-top:18px"><a href="${APP_URL}" style="color:#0D63DB;font-weight:700">Conheça a Bid Pro Brasil →</a></p>
        </div>`,
      }),
    });
  } catch (_) { /* não bloqueia o atendimento */ }

  return json({ ok: true });
}
