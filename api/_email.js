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
  const destinos = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!RESEND_KEY) {
    // Sem a key não sai e-mail nenhum — e, sem este registro, isso era INVISÍVEL (o return
    // acontecia antes do log). Um problema de configuração precisa aparecer no 360/health-check.
    await registrarEmailLog(destinos.map((dest) => ({
      user_id: meta?.userId || null,
      destinatario: String(dest).toLowerCase().slice(0, 200),
      assunto: (subject || '').slice(0, 300),
      tipo: meta?.tipo || null,
      status: 'falha',
      erro: 'RESEND_API_KEY ausente',
    })));
    return { ok: false, error: 'sem_resend' };
  }
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
  // O `await` é ESSENCIAL, não estilo: sem ele a função serverless respondia e podia ser
  // congelada antes de o insert completar, perdendo o registro de forma intermitente. Foi o
  // que aconteceu com as boas-vindas de 31/07, 01/08 e 02/08 — os e-mails SAÍRAM (uso do
  // Resend registrado no mesmo segundo), mas sumiram do card "E-mails recebidos" do 360.
  await registrarEmailLog(payload.to.map((dest) => ({
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

// E-mail de BOAS-VINDAS + aviso anti-"squatting", disparado UMA vez por conta (em qualquer
// caminho de cadastro). Como o acesso pode ser liberado sem etapa de confirmação, avisamos
// o dono do endereço; se não foi ele, recupera via "Esqueci minha senha" (o link só chega
// no e-mail dele). Best-effort: quem chama trata falha sem derrubar o fluxo.
export async function enviarBoasVindas({ to, nome, origin, userId }) {
  const base = origin || process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  const loginUrl = `${base}/#/login`;
  const primeiroNome = String(nome || '').trim().split(' ')[0] || 'Investidor';
  return enviarEmail({
    to,
    subject: 'Bem-vindo(a) à BidPro Brasil — sua conta foi criada',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
      <h2 style="color:#0D63DB;margin:0 0 12px">Olá, ${primeiroNome}! 👋</h2>
      <p style="font-size:15px;line-height:1.6">Sua conta na <strong>BidPro Brasil</strong> foi criada e já está ativa. Você pode buscar leilões em todo o Brasil, usar a calculadora de arrematação e acessar os materiais.</p>
      <p style="margin:20px 0"><a href="${loginUrl}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Acessar minha conta</a></p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.6;color:#9a3412">
        <strong>Não reconhece este cadastro?</strong> Se não foi você quem criou esta conta, alguém pode ter usado o seu e-mail. Você pode assumir o acesso em <a href="${loginUrl}" style="color:#9a3412;font-weight:700">${loginUrl.replace(/^https?:\/\//, '')}</a> usando <strong>"Esqueci minha senha"</strong> (o link de redefinição só chega neste e-mail), ou responder a esta mensagem que ajudamos.
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px">BidPro Brasil — Leilão &amp; Investimentos</p>
    </div>`,
    text: `Olá, ${primeiroNome}!\n\nSua conta na BidPro Brasil foi criada e já está ativa. Acesse em ${loginUrl}.\n\nNão reconhece este cadastro? Se não foi você, alguém pode ter usado o seu e-mail. Assuma o acesso em ${loginUrl} usando "Esqueci minha senha" (o link só chega neste e-mail), ou responda a esta mensagem.\n\nBidPro Brasil — Leilão & Investimentos`,
    meta: { tipo: 'boas_vindas', userId: userId || null },
  });
}
