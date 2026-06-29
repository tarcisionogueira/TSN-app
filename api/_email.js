/**
 * Helper de envio de e-mail via Resend (Edge-compatível).
 * Suporta anexos: { filename, path } (URL que o Resend busca) ou { filename, content } (base64).
 * Retorna { ok, id, error }.
 */
const RESEND_KEY = process.env.RESEND_API_KEY;

export async function enviarEmail({ from, to, subject, html, text, attachments, replyTo, headers }) {
  if (!RESEND_KEY) return { ok: false, error: 'sem_resend' };
  const payload = {
    from: from || 'BidPro Brasil <noreply@bidprobrasil.com.br>',
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (headers) payload.headers = headers;
  if (attachments?.length) payload.attachments = attachments;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `resend_${res.status}` };
    return { ok: true, id: data?.id || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
