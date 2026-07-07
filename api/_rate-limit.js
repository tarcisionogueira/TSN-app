/**
 * Rate limiting híbrido para Edge e Node.js runtime.
 *
 *   L1 — Map em memória (por instância): instantâneo, barra rajadas na mesma
 *        instância sem custo de rede.
 *   L2 — Upstash Redis (opcional, cross-instance): contador global atômico
 *        (INCR + EXPIRE) para valer entre TODAS as instâncias serverless.
 *
 * FAIL-OPEN (requisito de disponibilidade): se o Redis não estiver configurado
 * OU falhar/expirar, a decisão cai para o L1. A plataforma nunca bloqueia
 * tráfego legítimo por causa da infra de rate-limit.
 *
 * Para ligar o L2, defina no Vercel (via Marketplace → Upstash Redis):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * Sem essas variáveis, o comportamento é idêntico ao limiter em memória de antes.
 *
 * IMPORTANTE: checkRateLimit é ASSÍNCRONA — os chamadores usam `await`.
 */

const store = new Map(); // chave → { count, resetAt }

function checkLocal(key, limit, windowMs) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  return { ok: entry.count <= limit, remaining, resetAt: entry.resetAt };
}

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_ON = !!(UPSTASH_URL && UPSTASH_TOKEN);

// Fixed-window distribuído: INCR sempre; EXPIRE só na 1ª batida (flag NX = "só se
// ainda não há TTL"), senão o TTL seria reiniciado a cada request e a chave nunca
// expiraria. Retorna o contador atual, ou null se o Redis falhar (→ fail-open).
async function redisIncr(key, windowMs) {
  const ttl = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(ttl), 'NX']]),
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const count = Number(data?.[0]?.result);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key      - identificador único (ex: `${ip}:${rota}`)
 * @param {number} limit    - máximo de requisições na janela
 * @param {number} windowMs - tamanho da janela em ms (padrão 60s)
 * @returns {Promise<{ ok: boolean, remaining: number, resetAt: number }>}
 */
export async function checkRateLimit(key, limit, windowMs = 60_000) {
  // L1 primeiro: se já estourou na instância, bloqueia sem tocar no Redis.
  const local = checkLocal(key, limit, windowMs);
  if (!local.ok) return local;
  if (!REDIS_ON) return local; // sem Upstash → só L1 (idêntico ao comportamento antigo)

  // L2: contador global entre instâncias.
  const count = await redisIncr(`rl:${key}`, windowMs);
  if (count == null) return local; // Redis indisponível → fail-open no L1

  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + windowMs,
  };
}

/** Extrai IP do request (Edge ou Node.js) */
export function getIP(req) {
  // Edge Runtime (Request padrão)
  if (req.headers?.get) {
    return (
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
    );
  }
  // Node.js Runtime
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Retorna Response de erro 429 padronizado (Edge Runtime).
 */
export function rateLimitedResponse(resetAt) {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({ error: 'Muitas requisições. Tente novamente em instantes.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

/**
 * Retorna res.status(429) para Node.js Runtime.
 */
export function rateLimitedRes(res, resetAt) {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.' });
}
