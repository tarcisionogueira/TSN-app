export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// Fase B — Monitoramento 360º do cliente (só admin/analista).
//   GET /api/admin-usuario-360?q=termo       → busca usuários por nome/e-mail
//   GET /api/admin-usuario-360?user_id=uuid  → retrato 360º do usuário
// Usa as funções SECURITY DEFINER admin_busca_usuarios/admin_usuario_360 via
// service_role — não afrouxa RLS das tabelas de análise.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, args) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SB || !KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });

  const params = new URL(req.url).searchParams;
  const q = (params.get('q') || '').trim();
  const uid = params.get('user_id');

  let data;
  if (uid) data = await rpc('admin_usuario_360', { uid });
  else if (q) data = await rpc('admin_busca_usuarios', { termo: q });
  else data = { error: 'Informe user_id ou q' };

  return new Response(JSON.stringify(data ?? { error: 'Falha ao consultar' }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
