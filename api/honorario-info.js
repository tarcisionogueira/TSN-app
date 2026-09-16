/**
 * GET /api/honorario-info?id=<arrematacao_id>
 *
 * Dado público e mínimo pro checkout de honorários (src/pages/PagarHonorario.jsx) renderizar
 * SEM exigir login (18/09, pedido do dono: o arrematante pode repassar o link a outra pessoa
 * pagar — raro, mas acontece). Antes a página lia `arrematacoes` direto via supabase-js, o
 * que dependia de sessão pra passar pela RLS; agora é este endpoint, com service key, que
 * devolve só os 3 campos que a tela realmente precisa — nunca CPF/telefone/nome completo do
 * arrematante nem dados de outra cobrança. O `id` é um uuid imprevisível (conhecido só por
 * quem recebeu o link) — é ele que faz o papel de credencial neste fluxo, mesmo modelo do
 * antigo link hospedado do Mercado Pago.
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
  const rl = await checkRateLimit(`honorario-info:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return new Response(JSON.stringify({ error: 'id inválido' }), { status: 400 });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/arrematacoes?id=eq.${encodeURIComponent(id)}&select=id,valor_arrematado,honorarios_valor,honorarios_status`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000),
  });
  const [arr] = r.ok ? await r.json().catch(() => []) : [];
  if (!arr) return new Response(JSON.stringify({ error: 'Cobrança não encontrada' }), { status: 404 });

  return new Response(JSON.stringify({
    id: arr.id,
    valor_arrematado: arr.valor_arrematado,
    honorarios_valor: arr.honorarios_valor,
    honorarios_status: arr.honorarios_status,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
