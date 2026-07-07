export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`notificar-reuniao:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (!['admin', 'consultor', 'analista', 'advogado'].includes(role)) return forbidden('Apenas consultores podem enviar notificações de reunião');

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 });

  let reqBody;
  try {
    reqBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { clienteEmail, clienteNome, imovelNome, imovelCidade, reuniaoEm, reuniaoDuracao, meetLink: meetLinkRaw, calendarUrl: calendarUrlRaw } = reqBody;

  // Sanitiza URLs para evitar injeção de javascript: ou data: em emails enviados a clientes
  function sanitizarUrl(u) {
    try { const p = new URL(u); return ['https:','http:'].includes(p.protocol) ? u : '#'; } catch { return '#'; }
  }
  const meetLink = sanitizarUrl(meetLinkRaw || '');
  const calendarUrl = sanitizarUrl(calendarUrlRaw || '');

  if (!clienteEmail || !reuniaoEm || !meetLink) {
    return new Response(JSON.stringify({ error: 'dados insuficientes' }), { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clienteEmail)) {
    return new Response(JSON.stringify({ error: 'clienteEmail inválido' }), { status: 400 });
  }

  const dataFormatada = new Date(reuniaoEm).toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:580px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
      <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.02em;">BidPro Brasil</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Assessoria em Imóveis de Leilão</div>
    </div>
    <div style="background:#fff;padding:32px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <h2 style="margin:0 0 6px;font-size:20px;color:#0f172a;">Olá${clienteNome ? ', ' + clienteNome : ''}!</h2>
      <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
        Uma reunião de consultoria foi agendada para você. Veja os detalhes abaixo:
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
        <div style="font-size:13px;color:#064e3b;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:14px;">Detalhes da Reunião</div>
        ${imovelNome ? `<div style="margin-bottom:10px;"><span style="font-size:13px;color:#64748b;">Imóvel:</span> <strong style="color:#0f172a;">${imovelNome}${imovelCidade ? ' — ' + imovelCidade : ''}</strong></div>` : ''}
        <div style="margin-bottom:10px;"><span style="font-size:13px;color:#64748b;">Data e horário:</span> <strong style="color:#0f172a;text-transform:capitalize;">${dataFormatada} (horário de Brasília)</strong></div>
        <div style="margin-bottom:10px;"><span style="font-size:13px;color:#64748b;">Duração:</span> <strong style="color:#0f172a;">${reuniaoDuracao} minutos</strong></div>
      </div>

      <div style="text-align:center;margin-bottom:20px;">
        <a href="${meetLink}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;margin-bottom:12px;">
          📹 Entrar na Reunião
        </a>
        <br>
        <a href="${calendarUrl}" target="_blank" style="display:inline-block;color:#2563eb;text-decoration:none;font-size:13px;margin-top:8px;">
          📅 Adicionar ao Google Calendar
        </a>
      </div>

      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px 18px;font-size:13px;color:#78350f;line-height:1.6;">
        <strong>⚠️ Aviso de transcrição:</strong> Esta reunião é automaticamente transcrita para fins de qualidade e auditoria interna. Ao entrar na sala, você declara ciência e concordância com a transcrição, em conformidade com a <strong>Lei 9.296/1996, Art. 10</strong> e a <strong>LGPD (Lei 13.709/2018), Art. 7º, I</strong>.
      </div>

      <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;text-align:center;">
        BidPro Brasil · Assessoria em Imóveis de Leilão · Brasil
      </p>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.APP_FROM_EMAIL || 'BidPro Brasil <noreply@bidprobrasil.com.br>',
      to: clienteEmail,
      subject: `Reunião agendada — ${dataFormatada}`,
      html,
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
