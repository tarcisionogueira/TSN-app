/**
 * Envia push notification para um usuário ou grupo.
 * Apenas admin/consultor pode chamar.
 *
 * POST {
 *   user_id?: string,       // envia para 1 usuário
 *   role?: string,          // envia para todos com esse role
 *   title: string,
 *   body: string,
 *   url?: string,           // rota interna do app
 *   tag?: string,           // agrupa notificações
 * }
 */
export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { sanitizeText } from './_sanitize.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

// Converte base64url para Uint8Array
function b64urlToUint8(b64) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Gera JWT VAPID usando Web Crypto (disponível no Edge Runtime)
async function gerarVapidJwt(audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: `mailto:alertas@bidprobrasil.com.br`,
  };

  const enc = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const toSign = `${headerB64}.${payloadB64}`;

  const privBytes = b64urlToUint8(VAPID_PRIVATE);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', privBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, enc.encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${toSign}.${sigB64}`;
}

async function enviarParaSubscription(sub, payload) {
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { ok: false, erro: 'subscription incompleta' };

  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await gerarVapidJwt(audience);

    const body = JSON.stringify(payload);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC}`,
        TTL: '86400',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 410 || res.status === 404) {
      // Subscription expirada — remove do banco
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
      return { ok: false, erro: 'subscription_expirada' };
    }

    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`push-send:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const role = await getUserRoleById(user.id);
  if (!['admin', 'consultor', 'analista'].includes(role)) return forbidden('Sem permissão para enviar notificações');

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'VAPID keys não configuradas' }), { status: 500 });
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers });
  }

  const { user_id, role: targetRole, title, body: msgBody, url = '/', tag = 'tsn' } = body;

  if (!title || !msgBody) return new Response(JSON.stringify({ error: 'title e body obrigatórios' }), { status: 400, headers });

  const payload = {
    title: sanitizeText(title, 100),
    body: sanitizeText(msgBody, 200),
    url,
    tag,
    icon: '/logo.svg',
  };

  // Busca subscriptions
  let query = 'push_subscriptions?select=endpoint,p256dh,auth,user_id';
  if (user_id) query += `&user_id=eq.${encodeURIComponent(user_id)}`;
  else if (targetRole) {
    // Busca user_ids com esse role
    const perfisRes = await sb(`perfis?role=eq.${encodeURIComponent(targetRole)}&select=id`);
    const perfis = await perfisRes.json();
    const ids = (perfis || []).map(p => p.id);
    if (!ids.length) return new Response(JSON.stringify({ ok: true, enviados: 0 }), { status: 200, headers });
    query += `&user_id=in.(${ids.map(id => encodeURIComponent(id)).join(',')})`;
  }

  const subsRes = await sb(query);
  const subs = await subsRes.json();

  if (!subs?.length) return new Response(JSON.stringify({ ok: true, enviados: 0, mensagem: 'Nenhuma subscription encontrada' }), { status: 200, headers });

  const resultados = await Promise.all(subs.map(s => enviarParaSubscription(s, payload)));
  const enviados = resultados.filter(r => r.ok).length;
  const falhas = resultados.filter(r => !r.ok).length;

  return new Response(JSON.stringify({ ok: true, enviados, falhas, total: subs.length }), { status: 200, headers });
}
