/**
 * POST /api/registrar-aceite
 * Registra o aceite do termo de compra em aceites_plano COM o IP de origem
 * (capturado no servidor) — prova para defesa de chargeback.
 *
 * Body: { plano_key | produto_ref, valor, asaas_payment_id?, asaas_subscription_id?,
 *         termos_versao, user_agent? }
 * Auth: usuário logado.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent') || body.user_agent || null;

  const registro = {
    user_id: user.id,
    user_email: user.email || null,
    plano_key: body.plano_key || body.produto_ref || 'produto',
    valor: body.valor != null ? Number(body.valor) : null,
    asaas_payment_id: body.asaas_payment_id || null,
    asaas_subscription_id: body.asaas_subscription_id || null,
    ip,
    user_agent: userAgent,
    termos_versao: body.termos_versao || null,
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/aceites_plano`, {
    method: 'POST',
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(registro),
  });

  if (!r.ok) {
    const e = await r.text();
    return new Response(JSON.stringify({ error: 'Falha ao registrar aceite', detalhe: e.slice(0, 200) }), { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
