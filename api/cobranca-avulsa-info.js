/**
 * GET /api/cobranca-avulsa-info?id=<cobranca_id>
 *
 * Dado público mínimo pro checkout de cobrança avulsa (src/pages/CobrarAvulso.jsx)
 * renderizar sem exigir login — mesmo modelo de api/honorario-info.js. O `id` (uuid
 * imprevisível, conhecido só por quem recebeu o link) é a credencial deste fluxo.
 */
export const config = { runtime: 'edge' };

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (!SUPABASE_URL || !SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`cobranca-avulsa-info:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return new Response(JSON.stringify({ error: 'id inválido' }), { status: 400 });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/cobrancas_avulsas?id=eq.${encodeURIComponent(id)}&select=id,descricao,valor,status`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000),
  });
  const [cob] = r.ok ? await r.json().catch(() => []) : [];
  if (!cob) return new Response(JSON.stringify({ error: 'Cobrança não encontrada' }), { status: 404 });

  return new Response(JSON.stringify({
    id: cob.id, descricao: cob.descricao, valor: cob.valor, status: cob.status,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
