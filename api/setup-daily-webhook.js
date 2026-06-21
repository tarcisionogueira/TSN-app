export const config = { runtime: 'edge' };

// Chame esse endpoint UMA VEZ para registrar o webhook no Daily.co
// GET /api/setup-daily-webhook (somente admin)
export default async function handler(req) {
  const DAILY_KEY = process.env.DAILY_API_KEY;
  const BASE_URL = process.env.APP_BASE_URL || 'https://tsnativos.com.br';

  if (!DAILY_KEY) return new Response(JSON.stringify({ error: 'DAILY_API_KEY não configurada' }), { status: 500 });

  // Lista webhooks existentes para evitar duplicata
  const listaRes = await fetch('https://api.daily.co/v1/webhooks', {
    headers: { Authorization: `Bearer ${DAILY_KEY}` },
  });
  const lista = await listaRes.json();
  const jaExiste = (lista?.data || []).some(w => w.url?.includes('daily-webhook'));

  if (jaExiste) {
    return new Response(JSON.stringify({ ok: true, msg: 'Webhook já registrado', webhooks: lista.data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.daily.co/v1/webhooks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DAILY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${BASE_URL}/api/daily-webhook`,
      event_types: ['transcription.started', 'transcription.stopped', 'transcription.ready-on-s3'],
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify({ ok: res.ok, data }), {
    status: res.status, headers: { 'Content-Type': 'application/json' },
  });
}
