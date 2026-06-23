/**
 * Salva ou remove subscription de push do usuário.
 * POST { subscription, action: 'subscribe'|'unsubscribe' }
 */
export const config = { runtime: 'edge' };
import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`push-subscribe:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers });
  }

  const { subscription, action = 'subscribe' } = body;

  if (action === 'unsubscribe') {
    await sb(`push_subscriptions?user_id=eq.${user.id}`, { method: 'DELETE' });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (!subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'subscription inválida' }), { status: 400, headers });
  }

  // Upsert: um registro por usuário (substitui se já existe)
  await sb('push_subscriptions', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh || null,
      auth: subscription.keys?.auth || null,
      user_agent: req.headers.get('user-agent')?.slice(0, 200) || null,
    }),
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
