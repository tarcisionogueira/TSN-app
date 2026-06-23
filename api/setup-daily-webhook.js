export const config = { runtime: 'edge' };

// Chame esse endpoint UMA VEZ para registrar o webhook no Daily.co
// GET /api/setup-daily-webhook?secret=CRON_SECRET (somente admin)
export default async function handler(req) {
  const CRON_SECRET = process.env.CRON_SECRET;
  if (CRON_SECRET) {
    const url = new URL(req.url);
    const sentSecret = url.searchParams.get('secret') || req.headers.get('x-cron-secret') || '';
    if (sentSecret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Acesso negado' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const DAILY_KEY = process.env.DAILY_API_KEY;
  const BASE_URL = process.env.APP_BASE_URL || 'https://tsn-app-two.vercel.app';

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
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify({ ok: res.ok, data }), {
    status: res.status, headers: { 'Content-Type': 'application/json' },
  });
}
