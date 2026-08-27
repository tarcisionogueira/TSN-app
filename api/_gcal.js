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
  // GERAR SALA DO MEET (26/08). O Google cria o link junto com o evento quando pedimos
  // `conferenceData` — não existe API para "criar um Meet avulso". Por isso a sala da aula
  // nasce de um evento na agenda, e não de uma chamada separada.
  comMeet = false,
  // Regra RRULE (ex.: 'RRULE:FREQ=WEEKLY;BYDAY=WE'). Num evento recorrente o Google
  // mantém o MESMO link do Meet em todas as ocorrências — que é exatamente o que a aula
  // semanal precisa: um link que não muda toda quarta.
  recorrencia = null,
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

  if (recorrencia) body.recurrence = [recorrencia];
  if (comMeet) {
    // `requestId` precisa ser único por pedido; repetir um id devolve a MESMA conferência,
    // o que aqui seria um bug silencioso (duas aulas dividindo a sala).
    body.conferenceData = {
      createRequest: {
        requestId: `bidpro-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  // `conferenceDataVersion=1` é OBRIGATÓRIO para o Google honrar o conferenceData. Sem ele
  // a chamada responde 200, o evento é criado — e vem SEM sala, sem erro nenhum. É o vazio
  // que não sabe que falhou, do jeito mais caro: a aula estreia sem link.
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    + `?sendUpdates=all${comMeet ? '&conferenceDataVersion=1' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Google Calendar insert: ${data.error?.message || res.status}`);
  }
  // O link do Meet pode vir em `hangoutLink` ou dentro de `conferenceData.entryPoints`,
  // dependendo de como a conta está configurada. Ler só um dos dois devolveria "sem sala"
  // metade das vezes.
  const meet = data.hangoutLink
    || (data.conferenceData?.entryPoints || []).find(e => e.entryPointType === 'video')?.uri
    || null;
  if (comMeet && !meet) {
    // Não lançamos: o evento existe e a aula pode acontecer com link posto à mão. Mas quem
    // chamou PRECISA saber que a sala não veio, senão confirma para o público uma aula sem
    // endereço.
    console.error('[gcal] evento criado SEM sala do Meet', data.id);
  }
  return { eventId: data.id, htmlLink: data.htmlLink, meetLink: meet };
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
