/**
 * /api/limpar-eventos-cron — retenção do clickstream. Apaga eventos_atividade com mais de
 * 30 dias (economia — a tabela é de alto volume). Roda 1x/dia. Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RETENCAO_DIAS = 30;

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB || !KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  const corte = new Date(Date.now() - RETENCAO_DIAS * 86400000).toISOString();
  try {
    await fetch(`${SB}/rest/v1/eventos_atividade?criado_em=lt.${encodeURIComponent(corte)}`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, corte }), { headers: { 'Content-Type': 'application/json' } });
}
