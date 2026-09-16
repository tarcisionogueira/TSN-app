/**
 * POST /api/registrar-aceite
 * Registra o aceite do termo de compra em aceites_plano COM o IP de origem
 * (capturado no servidor) — prova para defesa de chargeback.
 *
 * Body: { plano_key | produto_ref, valor, asaas_payment_id?, asaas_subscription_id?,
 *         termos_versao, user_agent?, arrematacao_id? }
 * Auth: usuário logado — EXCETO plano_key='assessorado' com arrematacao_id (18/09): o
 * checkout de honorários de êxito não exige mais login (o arrematante pode repassar o link
 * a outra pessoa pagar), então o aceite anônimo é atribuído ao DONO da cobrança
 * (arrematacoes.arrematante_id), nunca a quem está clicando — mesmo princípio de IDOR já
 * aplicado em api/mp-checkout.js para este fluxo.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  let userId = user?.id || null;
  let userEmail = user?.email || null;
  if (!userId) {
    if (body?.plano_key !== 'assessorado' || !body?.arrematacao_id) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/arrematacoes?id=eq.${encodeURIComponent(body.arrematacao_id)}&select=arrematante_id`, {
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
    });
    const [arr] = r.ok ? await r.json().catch(() => []) : [];
    if (!arr?.arrematante_id) return new Response(JSON.stringify({ error: 'Cobrança não encontrada' }), { status: 404 });
    userId = arr.arrematante_id; // atribui ao dono da cobrança, não a quem clicou
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent') || body.user_agent || null;

  const registro = {
    user_id: userId,
    user_email: userEmail,
    plano_key: body.plano_key || body.produto_ref || 'produto',
    valor: body.valor != null ? Number(body.valor) : null,
    asaas_payment_id: body.asaas_payment_id || null,
    asaas_subscription_id: body.asaas_subscription_id || null,
    ip,
    user_agent: userAgent,
    termos_versao: body.termos_versao || null,
    gateway: body.gateway || null,
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
