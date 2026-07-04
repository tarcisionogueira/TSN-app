export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// Serve o ÚLTIMO relatório de auditoria (só leitura) para o dashboard admin.
// A auditoria em si roda na GitHub Action (scripts/auditoria-claude.mjs).
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  let row = null;
  try {
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/auditoria_sistema?select=*&order=gerado_em.desc&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) { const [x] = await r.json(); row = x || null; }
    }
  } catch { /* degrada para vazio */ }

  return new Response(JSON.stringify(row || { vazio: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
