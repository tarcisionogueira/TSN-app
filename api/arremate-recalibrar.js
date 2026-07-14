export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { recalcularArremate } from './_arremate-aprendizado.js';

// POST /api/arremate-recalibrar            → recalcula TODO o corpus (admin/analista)
// POST /api/arremate-recalibrar {imovel_id}→ recalcula só um arremate
// Atualiza previsto×realizado e a assertividade a partir dos relatórios já gerados,
// do valor arrematado e dos documentos (ex.: contrato do banco → financiado).
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
  if (!SB || !KEY) return json({ error: 'Supabase não configurado' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* corpo opcional */ }
  const alvo = body?.imovel_id ? String(body.imovel_id) : null;

  let ids = [];
  if (alvo) {
    ids = [alvo];
  } else {
    const r = await fetch(`${SB}/rest/v1/arremate_aprendizado?select=imovel_id&order=updated_at.asc&limit=500`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    ids = (Array.isArray(rows) ? rows : []).map((x) => x.imovel_id).filter(Boolean);
  }

  let ok = 0;
  for (const id of ids) { try { await recalcularArremate(id); ok++; } catch { /* segue */ } }
  return json({ ok: true, recalculados: ok, total: ids.length });
}
