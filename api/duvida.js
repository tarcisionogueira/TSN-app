/**
 * POST /api/duvida  (público, sem login)
 * Recebe uma dúvida (nome, email, mensagem), grava em `duvidas` e envia por
 * e-mail à equipe (com reply-to do remetente) para o consultor responder.
 */
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const SUPORTE      = process.env.SUPORTE_EMAIL || 'suporte@bidprobrasil.com.br';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors() });

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const nome = String(body.nome || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().slice(0, 160);
  const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
  const origem = String(body.origem || 'planos').slice(0, 40);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
  if (mensagem.length < 5) return json({ error: 'Escreva sua dúvida' }, 400);

  // 1. Grava (backup) — server-only via service key
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/duvidas`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ nome, email, mensagem, origem }),
    });
  } catch (_) {}

  // 2. Envia à equipe (reply-to do cliente → consultor responde direto)
  if (RESEND_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
          to: [SUPORTE],
          reply_to: email,
          subject: `Nova dúvida (${origem})${nome ? ' — ' + nome : ''}`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
            <h2 style="color:#0D63DB">Nova dúvida recebida</h2>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:12px 0">
              <div><b>Nome:</b> ${nome || '—'}</div>
              <div><b>E-mail:</b> ${email}</div>
              <div><b>Origem:</b> ${origem}</div>
            </div>
            <p style="white-space:pre-wrap">${mensagem.replace(/</g, '&lt;')}</p>
            <p style="font-size:12px;color:#94a3b8">Responda este e-mail para falar direto com o cliente.</p>
          </div>`,
        }),
      });
    } catch (_) {}
  }

  return json({ ok: true });
}

function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors() } });
}
