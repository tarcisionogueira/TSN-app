/**
 * /api/reconciliar-asaas-cron — rede de segurança das assinaturas ASAAS.
 *
 * O Asaas é o gateway de BACKUP do Mercado Pago. Se o cliente paga no Asaas mas o
 * WEBHOOK falha (fila pausada, token divergente, indisponibilidade), ele fica pagando
 * e preso no Explorador. Este cron espelha a reconciliação do MP
 * (reconciliar-assinaturas-cron.js), com uma diferença importante: o Asaas NÃO carrega
 * external_reference, então o vínculo com o usuário é pelo E-MAIL do customer e o plano
 * vem do VALOR pago (mapearPlano) — a mesma regra do webhook.
 *
 * O que faz (idempotente, best-effort):
 *  - Varre os pagamentos PAGOS (CONFIRMED/RECEIVED) criados nos últimos 45 dias.
 *  - Resolve o e-mail do customer, acha o perfil e, se ele segue 'explorador' e NÃO é
 *    inadimplência, ativa o plano do valor pago e grava o asaas_id no perfil (para o
 *    webhook localizar o cliente pelo ID daí em diante).
 *  - Só age quando o papel está errado → rodar de novo não repete nada.
 *
 * NÃO credita comissão (igual à reconciliação do MP): comissão é responsabilidade do
 * webhook. Este cron cuida apenas de não deixar cliente pago preso no plano grátis.
 *
 * Roda de 6/6h (vercel.json). Autorizado por CRON_SECRET (Authorization: Bearer).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { supabase, buscarCliente, ativarPlanoDireto, mapearPlano } from './_webhook-core.js';

const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();

async function asaasGet(path) {
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: { access_token: ASAAS_KEY } });
  return r.ok ? r.json() : null;
}

// IMPORTANTE: exportar por MÉTODO nomeado (GET/POST), não `export default`. No runtime
// Node da Vercel, `export default` é tratado como assinatura Express (req, res) e o
// `Response` retornado é IGNORADO — a função trava até o maxDuration (504) a cada run.
export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!ASAAS_KEY) return new Response(JSON.stringify({ error: 'ASAAS_API_KEY ausente' }), { status: 500 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }

  // Janela: pagamentos criados nos últimos 45 dias (cobre o ciclo mensal vigente).
  // dateCreated do Asaas é DATA (YYYY-MM-DD); brackets vão URL-encodados (%5Bge%5D).
  const desde = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const emailCache = new Map(); // custId → email (evita repetir GET /customers/{id})
  const emailDoCustomer = async (custId) => {
    if (!custId) return null;
    if (emailCache.has(custId)) return emailCache.get(custId);
    const c = await asaasGet(`/customers/${custId}`);
    const email = c?.email || null;
    emailCache.set(custId, email);
    return email;
  };

  let verificados = 0, corrigidos = 0;
  const erros = [];
  try {
    for (const status of ['CONFIRMED', 'RECEIVED']) {
      for (let offset = 0; offset < 5000; offset += 100) {
        const data = await asaasGet(`/payments?status=${status}&dateCreated%5Bge%5D=${desde}&limit=100&offset=${offset}`);
        const results = data?.data || [];
        if (!results.length) break;

        for (const p of results) {
          const custId = typeof p.customer === 'string' ? p.customer : (p.customer?.id || null);
          if (!custId) continue;
          verificados++;

          // Vínculo: asaas_id (se já salvo) OU e-mail do customer no Asaas.
          const email = await emailDoCustomer(custId);
          const cliente = await buscarCliente({ gatewayCustomerId: custId, email, gateway: 'asaas' });
          if (!cliente) continue;

          // Órfão: pagou mas segue no Explorador (e não é suspensão por inadimplência).
          if (cliente.role !== 'explorador' || cliente.inadimplente_desde) continue;

          // Plano vem do valor pago (difference/upgrade avulso não mapeia → ignora).
          const mapeado = mapearPlano(Number(p.value), p.description || '');
          if (!mapeado) continue;

          try {
            await ativarPlanoDireto({ userId: cliente.id, planoKey: mapeado.role, gateway: 'asaas' });
            // Grava o asaas_id p/ o webhook localizar o cliente pelo ID daqui pra frente.
            await supabase.from('perfis').update({ asaas_id: custId }).eq('id', cliente.id);
            corrigidos++;
          } catch (e) {
            erros.push(`${cliente.id}: ${e?.message || 'erro'}`);
          }
        }
        if (!data?.hasMore) break;
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, parcial: { verificados, corrigidos } }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, verificados, corrigidos, erros: erros.slice(0, 20) }), { headers: { 'Content-Type': 'application/json' } });
}
