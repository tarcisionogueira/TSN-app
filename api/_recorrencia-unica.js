// UMA RECORRÊNCIA ATIVA POR CLIENTE, decidida DEPOIS do pagamento novo (04/10, pendência 123).
//
// Antes, o checkout (src/pages/Checkout.jsx) cancelava as assinaturas ativas nos DOIS gateways
// ANTES de criar a nova: upgrade ou troca de ciclo abandonado (ou com MP e Asaas falhando) deixava
// o cliente pagante SEM recorrência — e o webhook do cancelamento ainda mandava o e-mail de
// "resgate". O backstop B1 do mp-webhook só cancelava mandatos do próprio MP; assinatura nova pelo
// Asaas deixava a antiga do MP cobrando em dobro se só tirássemos o cancelamento do front.
//
// Aqui: quando a NOVA recorrência é confirmada (MP: mandato `authorized`; Asaas: pagamento
// confirmado de uma subscription), cancela as OUTRAS, nos dois gateways, mantendo a nova.
// Nunca lança: a ativação do plano não pode cair por causa da limpeza — mas qualquer falha
// ALERTA a equipe (é risco de cobrança dupla, tem que ser visto).
import { alertarErro } from './_error-alert.js';

const MP_BASE = 'https://api.mercadopago.com';
const asaasBase = () => (process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
const asaasKey = () => (process.env.ASAAS_API_KEY || '').trim();
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function asaasIdDoPerfil(userId) {
  if (!userId || !SB_URL || !SB_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(userId)}&select=asaas_id&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`perfis.asaas_id ${r.status}`);
  const [p] = await r.json();
  return p?.asaas_id || null;
}

// Assinaturas ACTIVE do cliente no Asaas. TRI-ESTADO como o `checarAsaasAtivo` da reconciliação:
// erro de consulta NÃO é "sem assinatura" (devolve { erro }).
export async function assinaturasAsaasAtivas({ asaasCustomerId, userId }) {
  const key = asaasKey();
  if (!key) return { subs: [], erro: null };
  try {
    const cust = asaasCustomerId || await asaasIdDoPerfil(userId);
    if (!cust) return { subs: [], erro: null };
    const r = await fetch(`${asaasBase()}/subscriptions?customer=${encodeURIComponent(cust)}&status=ACTIVE&limit=20`, { headers: { access_token: key } });
    if (!r.ok) return { subs: [], erro: `asaas subscriptions ${r.status}` };
    const d = await r.json();
    return { subs: (d?.data || []).map((s) => s.id).filter(Boolean), erro: null };
  } catch (e) { return { subs: [], erro: e?.message || String(e) }; }
}

export async function cancelarOutrasRecorrencias({ userId, email, asaasCustomerId, manterMpId = null, manterAsaasSubId = null, origem }) {
  const out = { mpCancelados: [], asaasCancelados: [], erros: [] };
  const mpToken = process.env.MP_ACCESS_TOKEN;

  // Mercado Pago: mandatos authorized DESTE usuário (external_reference `${userId}|plano`).
  if (mpToken && email && userId) {
    try {
      const r = await fetch(`${MP_BASE}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=20`, { headers: { Authorization: `Bearer ${mpToken}` } });
      if (!r.ok) throw new Error(`busca ${r.status}`);
      const d = await r.json();
      for (const p of d?.results || []) {
        if (String(p.id) === String(manterMpId || '')) continue;
        if (String(p.external_reference || '').split('|')[0] !== String(userId)) continue;
        const c = await fetch(`${MP_BASE}/preapproval/${p.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
        if (c.ok) out.mpCancelados.push(String(p.id)); else out.erros.push(`MP ${p.id}: ${c.status}`);
      }
    } catch (e) { out.erros.push(`MP: ${e?.message || e}`); }
  }

  // Asaas: assinaturas ACTIVE do cliente, menos a nova.
  const { subs, erro } = await assinaturasAsaasAtivas({ asaasCustomerId, userId });
  if (erro) out.erros.push(`Asaas (consulta): ${erro}`);
  for (const id of subs) {
    if (String(id) === String(manterAsaasSubId || '')) continue;
    try {
      const r = await fetch(`${asaasBase()}/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { access_token: asaasKey() } });
      if (r.ok) out.asaasCancelados.push(String(id)); else out.erros.push(`Asaas ${id}: ${r.status}`);
    } catch (e) { out.erros.push(`Asaas ${id}: ${e?.message || e}`); } // padrao-ok: motivo vai para out.erros, logado e alertado no fim
  }

  if (out.mpCancelados.length || out.asaasCancelados.length) {
    console.log(`[recorrencia-unica] ${origem}: user=${userId} mp=${out.mpCancelados.join(',') || '-'} asaas=${out.asaasCancelados.join(',') || '-'}`);
  }
  if (out.erros.length) {
    console.error(`[recorrencia-unica] ${origem}: falhas`, out.erros);
    alertarErro({ rota: `recorrencia-unica/${origem}`, erro: `Não consegui cancelar recorrência antiga — RISCO DE COBRANÇA DUPLA para o usuário ${userId}. Conferir nos painéis do MP/Asaas: ${out.erros.join(' | ')}`, extra: { userId, manterMpId, manterAsaasSubId } });
  }
  return out;
}
