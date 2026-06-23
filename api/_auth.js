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
