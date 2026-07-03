/**
 * Google Calendar — criação de eventos reais para as reuniões (agendamento híbrido).
 *
 * Autentica via OAuth 2.0 (refresh token de um usuário Google real). Como o evento
 * é criado "como o usuário", é possível CONVIDAR participantes (cliente + analista)
 * e disparar os convites/lembretes nativos da Google — inclusive em conta @gmail,
 * sem Google Workspace.
 *
 * Variáveis de ambiente (Vercel):
 *   GOOGLE_OAUTH_CLIENT_ID       → Client ID do OAuth 2.0
 *   GOOGLE_OAUTH_CLIENT_SECRET   → Client secret do OAuth 2.0
 *   GOOGLE_OAUTH_REFRESH_TOKEN   → refresh token do usuário dono da agenda
 *   GOOGLE_CALENDAR_ID           → calendário de destino (default: 'primary')
 *
 * Se não estiver configurado, `gcalConfigurado()` retorna false e o chamador segue
 * o fluxo normal (Daily + e-mail) sem quebrar.
 *
 * Nota de escala: em conta @gmail o refresh token exige que a tela de consentimento
 * OAuth esteja "Em produção" (senão expira em 7 dias). Ao escalar, migrar o e-mail
 * para Google Workspace no domínio próprio dá convites nativos com service account
 * + Domain-Wide Delegation, sem depender de refresh token pessoal.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function creds() {
  const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh_token = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!client_id || !client_secret || !refresh_token) return null;
  return { client_id, client_secret, refresh_token };
}

export function gcalConfigurado() {
  return !!creds();
}

async function obterAccessToken(c) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/**
 * Cria um evento no Google Calendar com convidados + lembretes nativos.
 * @returns {Promise<{ eventId: string, htmlLink: string } | null>} null se não configurado.
 * Lança erro em falha real (o chamador deve tratar sem abortar o agendamento).
 */
export async function criarEventoAgenda({
  titulo,
  descricao,
  local,
  inicioISO,
  duracaoMin = 30,
  convidados = [],   // [{ email, nome }]
  timeZone = 'America/Sao_Paulo',
}) {
  const c = creds();
  if (!c) return null;

  const token = await obterAccessToken(c);
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const inicio = new Date(inicioISO);
  const fim = new Date(inicio.getTime() + duracaoMin * 60000);

  const attendees = convidados.filter(g => g.email).map(g => ({ email: g.email, displayName: g.nome || undefined }));

  const body = {
    summary: titulo,
    description: descricao,
    location: local || undefined,
    start: { dateTime: inicio.toISOString(), timeZone },
    end: { dateTime: fim.toISOString(), timeZone },
    ...(attendees.length ? { attendees } : {}),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Google Calendar insert: ${data.error?.message || res.status}`);
  }
  return { eventId: data.id, htmlLink: data.htmlLink };
}

/**
 * Cancela um evento previamente criado (best-effort). Silencioso se não configurado.
 */
export async function cancelarEventoAgenda(eventId) {
  const c = creds();
  if (!c || !eventId) return false;
  try {
    const token = await obterAccessToken(c);
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    return res.ok || res.status === 410; // 410 = já removido
  } catch {
    return false;
  }
}
