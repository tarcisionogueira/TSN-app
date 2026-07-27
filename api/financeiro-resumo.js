/**
 * GET /api/financeiro-resumo?meses=6 — resumo financeiro para o admin (sintético + série).
 * Separa REAL recebido (mensalidades × vendas) das PROJEÇÕES (MRR). Lê tabelas locais via
 * RPC financeiro_resumo (econômico — não chama gateway). Só admin.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized, forbidden } from './_auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Método não permitido' }, 405);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const role = (await (await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${user.id}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })).json())?.[0]?.role;
  if (role !== 'admin') return forbidden();

  const meses = Math.min(24, Math.max(1, parseInt(new URL(req.url).searchParams.get('meses') || '6', 10) || 6));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/financeiro_resumo`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_meses: meses }),
  });
  if (!r.ok) return json({ error: 'Erro ao calcular o resumo', detail: await r.text() }, 500);
  return json(await r.json());
}
