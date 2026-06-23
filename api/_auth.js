/**
 * Helper de autenticação para Edge Runtime (Vercel).
 * Valida o JWT do Supabase enviado no header Authorization.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

/**
 * Retorna o usuário autenticado ou null.
 * Funciona com Edge Runtime (req é um Request padrão).
 */
export async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function unauthorized(msg = 'Não autorizado') {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export function forbidden(msg = 'Acesso negado') {
  return new Response(JSON.stringify({ error: msg }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// Aliases para compatibilidade com Node.js runtime (req.headers como objeto)
export async function getUser(req) {
  const auth = (req.headers?.get
    ? (req.headers.get('authorization') || req.headers.get('Authorization'))
    : (req.headers?.authorization || req.headers?.Authorization)) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getUserRole(req) {
  const user = await getUser(req);
  if (!user) return null;
  return getUserRoleById(user.id);
}

/** Busca role diretamente pelo userId (UUID) — usa service key para evitar falhas de RLS */
export async function getUserRoleById(userId) {
  if (!userId) return null;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const key = SERVICE_KEY || ANON_KEY;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}&select=role`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.role || null;
  } catch {
    return null;
  }
}
