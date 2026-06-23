const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Verifica JWT e retorna user, ou null se inválido
export async function getUser(req) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Busca role do perfil
export async function getUserRole(userId) {
  if (!userId) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}&select=role`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.role || null;
  } catch {
    return null;
  }
}

export const unauthorized = (msg = 'Não autorizado') =>
  new Response(JSON.stringify({ error: msg }), { status: 401, headers: { 'Content-Type': 'application/json' } });

export const forbidden = (msg = 'Acesso negado') =>
  new Response(JSON.stringify({ error: msg }), { status: 403, headers: { 'Content-Type': 'application/json' } });
