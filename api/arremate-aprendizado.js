export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// GET /api/arremate-aprendizado  (admin/analista)
// Painel do corpus: quantos arremates reais já ensinam a IA e a assertividade
// acumulada por modalidade (resumo via RPC) + os arremates recentes.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });

async function sbGet(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}
async function rpc(fn, args) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
  if (!SB || !KEY) return json({ error: 'Supabase não configurado' }, 500);

  const resumo = (await rpc('arremate_aprendizado_resumo', { p_modalidade: null })) || [];
  const itens = (await sbGet('arremate_aprendizado?select=imovel_id,modalidade,tipo_aquisicao,origem,previsto,realizado,assertividade,updated_at&order=updated_at.desc&limit=30')) || [];
  const todos = (await sbGet('arremate_aprendizado?select=id&limit=1000')) || [];

  return json({
    total: Array.isArray(todos) ? todos.length : 0,
    com_assertividade: Array.isArray(itens) ? itens.filter((x) => x.assertividade && Object.keys(x.assertividade).length).length : 0,
    resumo: Array.isArray(resumo) ? resumo : [],
    itens: Array.isArray(itens) ? itens : [],
  });
}
