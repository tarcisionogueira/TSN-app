/**
 * /api/ranks-recalc-cron — recalcula os NÍVEIS dos parceiros (graduação por duplicação).
 *
 * O rank de cada parceiro depende dos indicados diretos que ELES MESMOS subiram
 * (fixpoint bottom-up) + carência de 2 meses p/ queda — por isso é um recálculo em LOTE,
 * não live. Roda 1x/mês (vercel.json). Idempotente. Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB_URL || !SB_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/recalcular_ranks`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(50000),
    });
    const txt = await r.text().catch(() => '');
    if (!r.ok) return new Response(JSON.stringify({ ok: false, status: r.status, detalhe: txt.slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true, processados: Number(txt) || txt }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
