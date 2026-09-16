/**
 * GET/POST /api/ativar-promo-pro-honorario-cron — converte o upsell "Investidor Pro"
 * oferecido no checkout dos honorários de êxito (api/mp-checkout.js, proposito
 * 'honorario_exito' + tambem_pro=true) em assinatura RECORRENTE de verdade, cobrando o
 * preço cheio, 30 dias depois de o cartão ter sido salvo — sem pedir o cartão de novo.
 * Mesmo mecanismo (e mesma razão de existir) de api/ativar-assinatura-bonus-cron.js, só
 * que sobre `arrematacoes` em vez de `compras_produtos`.
 *
 * COMO GERA O TOKEN NOVO. O cartão foi salvo como Customer+Card do Mercado Pago no
 * momento do pagamento dos honorários. Um token de cartão do MP é de uso único — não dá
 * pra guardar o token da compra e usar de novo aqui. Gera-se um TOKEN NOVO a partir do
 * `card_id` salvo (`POST /v1/card_tokens {card_id, customer_id}`), e é esse token novo que
 * entra no preapproval.
 *
 * `authorized` NÃO É PAGAMENTO (mesma regra de criarAssinaturaTransparente em api/mp.js):
 * este cron só CRIA o preapproval e grava `promo_pro_mp_preapproval_id` como rastro de que
 * a tentativa foi feita. Quem ativa o plano de verdade é sempre o webhook (api/mp-webhook.js),
 * só com cobrança CONFIRMADA — nunca aqui. Cartão recusado não gera nova tentativa
 * automática (diferente do bônus, aqui é upsell avulso, não cortesia com prazo de validade).
 *
 * JANELA: converte candidatos com `promo_pro_inicio_em` até 2 dias no futuro (para não
 * perder o dia exato por causa do horário do cron) até 4 dias no passado (depois disso,
 * tentar mais tarde não faz sentido prático). Idempotente: `promo_pro_mp_preapproval_id is
 * null` tira do lote quem já convertiu; falha fica só no log — quem quiser pode reativar
 * manualmente pela tela do caso.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';

const MP_BASE = 'https://api.mercadopago.com';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const WEBHOOK = `${BASE}/api/mp-webhook`;
const DIA = 86400000;
const JANELA_ANTES_DIAS = 2;
const JANELA_DEPOIS_DIAS = 4;
const TETO_LOTE = 200;

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });

// Preço do top2 vem do banco, nunca hardcoded — mesmo princípio de ativar-assinatura-bonus-cron.
async function precoTop2() {
  try {
    const r = await sb('planos_config?plano_key=eq.top2&select=preco');
    if (r.ok) {
      const [row] = await r.json();
      const v = Number(row?.preco);
      if (v > 0) return v;
    }
  } catch { /* mantém o fallback abaixo */ }
  return 49.90;
}

async function emailDoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.email ? String(u.email).toLowerCase() : null;
  } catch (e) { console.error('[ativar-promo-pro-honorario] emailDoUsuario falhou:', e?.message); return null; }
}

async function mpTokenDoCartaoSalvo(accessToken, cardId, customerId) {
  const r = await fetch(`${MP_BASE}/v1/card_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id: cardId, customer_id: customerId }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.id) throw new Error(d?.message || `card_token_falhou_${r.status}`);
  return String(d.id);
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });

  const resumo = { elegiveis: 0, convertidos: 0, falhas: 0, sem_email: 0 };
  const agora = Date.now();
  const janelaMax = new Date(agora + JANELA_ANTES_DIAS * DIA).toISOString();
  const janelaMin = new Date(agora - JANELA_DEPOIS_DIAS * DIA).toISOString();

  const candRes = await sb(
    `arrematacoes?select=id,arrematante_id,promo_pro_mp_customer_id,promo_pro_mp_card_id` +
    `&promo_pro_mp_card_id=not.is.null&promo_pro_mp_preapproval_id=is.null` +
    `&promo_pro_inicio_em=lte.${encodeURIComponent(janelaMax)}&promo_pro_inicio_em=gte.${encodeURIComponent(janelaMin)}` +
    `&limit=${TETO_LOTE}`
  );
  if (!candRes.ok) {
    return new Response(JSON.stringify({ error: 'consulta de candidatos falhou', detalhe: await candRes.text().catch(() => '') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const candidatos = await candRes.json().catch(() => []);
  resumo.elegiveis = Array.isArray(candidatos) ? candidatos.length : 0;
  if (!resumo.elegiveis) return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });

  const valorTop2 = await precoTop2();

  for (const c of candidatos) {
    try {
      const email = await emailDoUsuario(c.arrematante_id);
      if (!email) { resumo.sem_email++; continue; }

      const chargeToken = await mpTokenDoCartaoSalvo(MP_TOKEN, c.promo_pro_mp_card_id, c.promo_pro_mp_customer_id);

      const body = {
        reason: 'Investidor Pro',
        external_reference: `${c.arrematante_id}|top2`,
        payer_email: email,
        card_token_id: chargeToken,
        // 'authorized' + card_token_id = mandato aceito. NÃO é cobrança confirmada — ver o
        // cabeçalho deste arquivo. Quem ativa o plano é o webhook, só com pagamento recebido.
        status: 'authorized',
        back_url: `${BASE}/#/checkout?plano=top2&status=assinatura`,
        notification_url: WEBHOOK,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(valorTop2), currency_id: 'BRL' },
      };
      const r = await fetch(`${MP_BASE}/preapproval`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `promo-pro-honorario-${c.id}` },
        body: JSON.stringify(body),
      });
      const sub = await r.json().catch(() => null);
      if (!r.ok || !sub?.id) throw new Error(sub?.message || sub?.cause?.[0]?.description || `preapproval_falhou_${r.status}`);

      await sb(`arrematacoes?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ promo_pro_mp_preapproval_id: String(sub.id) }),
      });
      resumo.convertidos++;
    } catch (e) {
      resumo.falhas++;
      console.error('[ativar-promo-pro-honorario] falha na arrematação', c.id, e?.message || e);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
