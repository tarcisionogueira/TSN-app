/**
 * Helper de envio de e-mail via Resend (Edge-compatível).
 * Suporta anexos: { filename, path } (URL que o Resend busca) ou { filename, content } (base64).
 * Retorna { ok, id, error }.
 */
import { registrarUso } from './_uso.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Registra o histórico de e-mails enviados (o Resend só retém por tempo limitado).
// Só metadados — assunto/tipo/status, nunca o corpo. Best-effort: NUNCA quebra o
// envio. Alimenta o card "E-mails recebidos" do Cliente 360.
async function registrarEmailLog(rows) {
  if (!SB_URL || !SB_KEY || !rows?.length) return;
  try {
    await fetch(`${SB_URL}/rest/v1/emails_log`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
  } catch { /* histórico é best-effort */ }
}

// meta (opcional): { tipo, userId } — categoriza e vincula o e-mail ao cliente.
export async function enviarEmail({ from, to, cc, subject, html, text, attachments, replyTo, headers, meta }) {
  if (!RESEND_KEY) return { ok: false, error: 'sem_resend' };
  const payload = {
    from: from || 'BidPro Brasil <noreply@bidprobrasil.com.br>',
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (cc?.length) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (headers) payload.headers = headers;
  if (attachments?.length) payload.attachments = attachments;

  let out;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      out = { ok: false, error: data?.message || `resend_${res.status}` };
    } else {
      const n = payload.to.length + (payload.cc?.length || 0); // destinatários faturados
      registrarUso('resend', 'email', { unidades: n });
      out = { ok: true, id: data?.id || null };
    }
  } catch (e) {
    out = { ok: false, error: String(e?.message || e) };
  }
  // Loga um registro por destinatário (to) — inclusive falhas, p/ auditoria.
  registrarEmailLog(payload.to.map((dest) => ({
    user_id: meta?.userId || null,
    destinatario: String(dest).toLowerCase().slice(0, 200),
    assunto: (subject || '').slice(0, 300),
    tipo: meta?.tipo || null,
    status: out.ok ? 'enviado' : 'falha',
    resend_id: out.ok ? (out.id || null) : null,
    erro: out.ok ? null : String(out.error || '').slice(0, 300),
  })));
  return out;
}
