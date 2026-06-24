/**
 * Rate limiting em memória para Edge e Node.js runtime.
 * Janela deslizante simples por chave (IP + rota).
 * Em ambiente serverless cada instância tem seu próprio mapa,
 * mas já bloqueia rajadas concentradas na mesma instância.
 */

const store = new Map(); // chave → { count, resetAt }

/**
 * @param {string} key      - identificador único (ex: `${ip}:${rota}`)
 * @param {number} limit    - máximo de requisições na janela
 * @param {number} windowMs - tamanho da janela em ms (padrão 60s)
 * @returns {{ ok: boolean, remaining: number, resetAt: number }}
 */
export function checkRateLimit(key, limit, windowMs = 60_000) {
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
