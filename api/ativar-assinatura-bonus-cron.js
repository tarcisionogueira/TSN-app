/**
 * GET/POST /api/ativar-assinatura-bonus-cron — converte o bônus "produto com cartão salvo"
 * (ebook/curso `requer_cartao_bonus`: R$1,00 + N meses de cortesia de Investidor Pro) em
 * assinatura RECORRENTE de verdade, cobrando o preço cheio, quando o bônus está prestes a
 * vencer — sem pedir o cartão de novo (regra do dono, 12/09).
 *
 * POR QUE EXISTE. O mecanismo de cortesia que já existia (concede_plano/concede_meses +
 * conceder_plano_usuario) nunca captura cartão — é entrega pura, e se a pessoa não voltar
 * para assinar sozinha, o acesso só expira (reconciliar-assinaturas-cron rebaixa a
 * Explorador ~5 dias depois, ver `grace` lá). Este produto é DIFERENTE: capturou o cartão
 * na compra (supabase/migrations/produto_bonus_assinatura_com_cartao.sql), então a conversão
 * pode ser automática. As DUAS formas convivem — este cron só mexe em compras com
 * `mp_card_id` preenchido.
 *
 * COMO GERA O TOKEN NOVO. O cartão foi salvo como Customer+Card do Mercado Pago no momento
 * da compra (api/mp-checkout.js, proposito='produto_bonus'). Um token de cartão do MP é de
 * uso único — não dá pra guardar o token da compra e usar de novo aqui. O jeito documentado
 * de cobrar um cartão salvo depois é gerar um TOKEN NOVO a partir do `card_id` salvo
 * (`POST /v1/card_tokens {card_id, customer_id}`), e é esse token novo que entra no
 * preapproval — mesmo mecanismo que api/mp-checkout.js já usa na hora da compra.
 *
 * `authorized` NÃO É PAGAMENTO (mesma regra de criarAssinaturaTransparente em api/mp.js,
 * 16/08): este cron só CRIA o preapproval e grava `assinatura_id`/`assinatura_ativada_em`
 * como rastro de que a tentativa foi feita. Quem ativa o plano de verdade é sempre o webhook
 * (api/mp-webhook.js), só com cobrança CONFIRMADA — nunca aqui. Se a cobrança falhar
 * (cartão recusado etc.), a cortesia expira sozinha pelo mecanismo que já existe
 * (`reconciliar-assinaturas-cron` rebaixa `plano_ciclo IN ('anual','cortesia')` vencido).
 *
 * JANELA: converte de 2 dias ANTES do vencimento (dá folga para a 1ª cobrança real, que é
 * assíncrona, confirmar antes da cortesia acabar) até 4 dias DEPOIS (depois disso a
 * reconciliação já rebaixou o plano — tentar mais tarde não teria efeito prático e só
 * gastaria chamada ao MP à toa). Idempotente: `assinatura_id is null` no filtro tira do lote
 * quem já convertiu; falha marca `assinatura_falhou_em`/`assinatura_falha_motivo` e ENTRA DE
 * NOVO no dia seguinte (dentro da janela) — cartão recusado por saldo insuficiente hoje pode
 * passar amanhã.
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
const JANELA_ANTES_DIAS = 2;   // converte até 2 dias antes do vencimento
const JANELA_DEPOIS_DIAS = 4;  // desiste 4 dias depois (reconciliação já rebaixou)
const TETO_LOTE = 200;         // válvula de segurança — bem acima do esperado

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });

// Preço do top2 vem do banco, nunca hardcoded (mesmo princípio de aviso-cortesia-vencendo) —
// só o valor à vista/mensal, nunca o anual (o bônus concede o plano, nunca o ciclo anual).
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
  } catch (e) { console.error('[ativar-assinatura-bonus] emailDoUsuario falhou:', e?.message); return null; }
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

  // `compras_produtos_bonus_pendente_idx` (mp_card_id is not null and assinatura_id is null)
  // cobre exatamente este filtro.
  const candRes = await sb(
    `compras_produtos?select=id,user_id,mp_customer_id,mp_card_id&status=eq.ativo` +
    `&mp_card_id=not.is.null&assinatura_id=is.null` +
    `&plano_concedido_ate=lte.${encodeURIComponent(janelaMax)}&plano_concedido_ate=gte.${encodeURIComponent(janelaMin)}` +
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
      const email = await emailDoUsuario(c.user_id);
      if (!email) { resumo.sem_email++; continue; }

      const chargeToken = await mpTokenDoCartaoSalvo(MP_TOKEN, c.mp_card_id, c.mp_customer_id);

      const body = {
        reason: 'Investidor Pro',
        external_reference: `${c.user_id}|top2`,
        payer_email: email,
        card_token_id: chargeToken,
        // 'authorized' + card_token_id = mandato aceito. NÃO é cobrança confirmada — ver o
        // cabeçalho deste arquivo e o mesmo comentário em criarAssinaturaTransparente
        // (api/mp.js). Quem ativa o plano é o webhook, só com pagamento recebido.
        status: 'authorized',
        back_url: `${BASE}/#/checkout?plano=top2&status=assinatura`,
        notification_url: WEBHOOK,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(valorTop2), currency_id: 'BRL' },
      };
      const r = await fetch(`${MP_BASE}/preapproval`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `bonus-${c.id}` },
        body: JSON.stringify(body),
      });
      const sub = await r.json().catch(() => null);
      if (!r.ok || !sub?.id) throw new Error(sub?.message || sub?.cause?.[0]?.description || `preapproval_falhou_${r.status}`);

      await sb(`compras_produtos?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ assinatura_id: String(sub.id), assinatura_ativada_em: new Date().toISOString() }),
      });
      resumo.convertidos++;
    } catch (e) {
      resumo.falhas++;
      console.error('[ativar-assinatura-bonus] falha na compra', c.id, e?.message || e);
      await sb(`compras_produtos?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ assinatura_falhou_em: new Date().toISOString(), assinatura_falha_motivo: String(e?.message || e).slice(0, 500) }),
      }).catch(() => {});
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
