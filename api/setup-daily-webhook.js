export const config = { runtime: 'edge' };

// Chame esse endpoint UMA VEZ para registrar o webhook no Daily.co
// GET /api/setup-daily-webhook?secret=CRON_SECRET (somente admin)
export default async function handler(req) {
  const { isCronAuthorized } = await import('./_auth.js');
  if (!isCronAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Acesso negado' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const DAILY_KEY = process.env.DAILY_API_KEY;
  // SEMPRE www: o apex bidprobrasil.com.br responde 308 e o Daily (como o Mercado
  // Pago) NÃO segue redirect → o webhook nunca seria entregue e as tabelas de
  // aprendizado ficariam vazias. Normaliza qualquer apex para www.
  const RAW_BASE = process.env.APP_BASE_URL || 'https://www.bidprobrasil.com.br';
  const BASE_URL = RAW_BASE.replace(/:\/\/(www\.)?bidprobrasil\.com\.br/, '://www.bidprobrasil.com.br');

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
