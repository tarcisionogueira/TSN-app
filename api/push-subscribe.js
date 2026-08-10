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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`push-subscribe:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers });
  }

  const { subscription, action = 'subscribe' } = body;

  if (action === 'unsubscribe') {
    const del = await sb(`push_subscriptions?user_id=eq.${user.id}`, { method: 'DELETE' });
    if (!del.ok) {
      console.error('[push-subscribe] delete falhou', del.status);
      return new Response(JSON.stringify({ error: 'Não foi possível desativar as notificações agora.' }), { status: 502, headers });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (!subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'subscription inválida' }), { status: 400, headers });
  }

  // Upsert: um registro por usuário (substitui se já existe).
  // O resultado era DESCARTADO e o handler devolvia ok:true de qualquer jeito: o usuário via
  // "notificações ativadas" e nunca recebia push, sem nada registrar a divergência. (10/08)
  // `on_conflict=user_id` é OBRIGATÓRIO aqui (10/08). `Prefer: resolution=merge-duplicates` sozinho
  // não diz ao PostgREST em QUAL restrição resolver o conflito, então ele tenta um INSERT puro e
  // bate na unique `push_subscriptions_user_id_key` com 409/23505 — ou seja, para quem JÁ tinha
  // inscrição (a maioria: o app reinscreve a cada acesso) a gravação NUNCA acontecia.
  // Isto estava mascarado pelo bug B2: como o resultado era descartado, o endpoint respondia
  // `ok:true` e o defeito era invisível. Ao passar a checar o `.ok`, o 409 apareceu de imediato
  // nos logs — a checagem não criou o problema, ela revelou um que já existia há tempo.
  // A tabela tem unique em `user_id` E em `endpoint`; conflito por `endpoint` (mesmo aparelho,
  // outra conta) é caso legítimo de erro e segue tratado abaixo.
  const ins = await sb('push_subscriptions?on_conflict=user_id', {
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
  if (!ins.ok) {
    console.error('[push-subscribe] upsert falhou', ins.status, (await ins.text().catch(() => '')).slice(0, 200));
    return new Response(JSON.stringify({ error: 'Não foi possível ativar as notificações agora.' }), { status: 502, headers });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
