/**
 * Google Calendar — criação de eventos reais para as reuniões (agendamento híbrido).
 *
 * Autentica via Service Account (JWT RS256, assinado com Web Crypto → compatível
 * com o Edge Runtime) e cria o evento com convidados + lembretes nativos da Google.
 *
 * Variáveis de ambiente (Vercel):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  → JSON completo da service account (client_email + private_key)
 *   GOOGLE_CALENDAR_ID           → calendário de destino (default: 'primary')
 *   GOOGLE_IMPERSONATE_SUBJECT   → (opcional) usuário Workspace a impersonar (Domain-Wide
 *                                  Delegation). Necessário para CONVIDAR participantes e
 *                                  disparar os e-mails/lembretes da Google.
 *
 * Se as credenciais não estiverem configuradas, `gcalConfigurado()` retorna false e o
 * chamador segue o fluxo normal (Daily + e-mail) sem quebrar.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

function lerServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) return null;
    // A private key costuma vir com \n escapados quando colada em env var.
    sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
    return sa;
  } catch {
    return null;
  }
}

export function gcalConfigurado() {
  return !!lerServiceAccount();
}

// ─── base64url helpers ──────────────────────────────────────────────────────
function b64urlFromString(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemParaDer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function obterAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const subject = process.env.GOOGLE_IMPERSONATE_SUBJECT;
  if (subject) claim.sub = subject;

  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemParaDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
  const assertion = `${signingInput}.${b64urlFromBytes(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/**
 * Cria um evento no Google Calendar.
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
  const sa = lerServiceAccount();
  if (!sa) return null;

  const token = await obterAccessToken(sa);
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const inicio = new Date(inicioISO);
  const fim = new Date(inicio.getTime() + duracaoMin * 60000);

  // attendees só surtem efeito (convite/lembrete) com Domain-Wide Delegation.
  const podeConvidar = !!process.env.GOOGLE_IMPERSONATE_SUBJECT;
  const attendees = podeConvidar
    ? convidados.filter(c => c.email).map(c => ({ email: c.email, displayName: c.nome || undefined }))
    : undefined;

  const body = {
    summary: titulo,
    description: descricao,
    location: local || undefined,
    start: { dateTime: inicio.toISOString(), timeZone },
    end: { dateTime: fim.toISOString(), timeZone },
    ...(attendees ? { attendees } : {}),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all&conferenceDataVersion=0`;
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
  const sa = lerServiceAccount();
  if (!sa || !eventId) return false;
  try {
    const token = await obterAccessToken(sa);
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    return res.ok || res.status === 410; // 410 = já removido
  } catch {
    return false;
  }
}
