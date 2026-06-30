/**
 * POST /api/mp
 * Gateway Mercado Pago — Checkout Pro, Assinaturas e Saques.
 *
 * Actions:
 *  criar_preferencia  — pagamento avulso (assessorado, matrícula, etc.)
 *  criar_assinatura   — assinatura recorrente (clube 5k/mês)
 *  verificar          — checa status de pagamento ou assinatura
 *  cancelar_assinatura
 *  status_assinatura
 */

export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const MP_URL    = 'https://api.mercadopago.com';
const TOKEN     = (process.env.MP_ACCESS_TOKEN || '').trim();
const BASE_URL  = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const WEBHOOK   = `${BASE_URL}/api/mp-webhook`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function mpPost(path, body) {
  const res = await fetch(`${MP_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.message || data.cause?.[0]?.description || JSON.stringify(data.cause || data);
    throw new Error(msg);
  }
  return data;
}

async function mpGet(path) {
  const res = await fetch(`${MP_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro MP');
  return data;
}

async function mpPut(path, body) {
  const res = await fetch(`${MP_URL}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro MP');
  return data;
}

// ─── Configurações de plano ───────────────────────────────────────────────────

const PLANOS_CONFIG = {
  assessorado:       { nome: 'Assessoria Pós-Arrematação',  valor: 5000.00, recorrente: false },
  assessorado_vista: { nome: 'Assessoria (À Vista)',         valor: 5000.00, recorrente: false },
  clube:             { nome: 'Leilão Club — Mensal',         valor: 5000.00, recorrente: true  },
  clube_vista:       { nome: 'Leilão Club (12× Anual)',      valor: 5000.00, recorrente: false },
  top2:              { nome: 'Investidor Pro',               valor: 99.90,  recorrente: true  },
  top2_anual:        { nome: 'Investidor Pro (Anual)',       valor: 797.00, recorrente: false },
};

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Cria preferência de pagamento (Checkout Pro).
 * Suporta pagamento misto (usuário divide PIX + cartão diretamente no MP).
 * Para split (ex: 2k PIX + 3k cartão), cria 2 preferências vinculadas.
 */
async function criarPreferencia({ plano: planoKey, email, nome, cpf, userId, parcelas = null, split = null }) {
  const cfg = PLANOS_CONFIG[planoKey];
  if (!cfg) throw new Error(`Plano inválido: ${planoKey}`);

  // Split de pagamento: [{ metodo, valor }]
  if (split && split.length > 1) {
    const prefs = await Promise.all(split.map((parte, i) =>
      criarPreferenciaSimples({
        titulo:  `${cfg.nome} — Parte ${i + 1}/${split.length}`,
        valor:   parte.valor,
        email, nome, cpf, userId,
        planoKey,
        splitIndex: i + 1,
        splitTotal: split.length,
        splitMetodo: parte.metodo,
        parcelas,
      })
    ));
    return { split: true, partes: prefs };
  }

  return criarPreferenciaSimples({ titulo: cfg.nome, valor: cfg.valor, email, nome, cpf, userId, planoKey, parcelas });
}

async function criarPreferenciaSimples({ titulo, valor, email, nome, cpf, userId, planoKey, splitIndex, splitTotal, splitMetodo, parcelas }) {
  const excludedMethods = [];
  if (splitMetodo === 'pix')     excludedMethods.push('credit_card', 'debit_card', 'ticket');
  if (splitMetodo === 'cartao')  excludedMethods.push('bank_transfer', 'ticket');
  if (splitMetodo === 'debito')  excludedMethods.push('credit_card', 'bank_transfer', 'ticket');

  const installments = parcelas ? Number(parcelas) : 12;

  const body = {
    items: [{
      id:           planoKey,
      title:        titulo,
      quantity:     1,
      currency_id:  'BRL',
      unit_price:   Number(valor),
    }],
    payer: { name: nome, email, identification: cpf ? { type: 'CPF', number: cpf.replace(/\D/g, '') } : undefined },
    back_urls: {
      success: `${BASE_URL}/#/checkout?plano=${planoKey}&status=approved`,
      failure: `${BASE_URL}/#/checkout?plano=${planoKey}&status=rejected`,
      pending: `${BASE_URL}/#/checkout?plano=${planoKey}&status=pending`,
    },
    auto_return:        'approved',
    notification_url:   WEBHOOK,
    statement_descriptor: 'BIDPRO BRASIL',
    external_reference: `${userId}|${planoKey}${splitIndex ? `|split${splitIndex}of${splitTotal}` : ''}`,
    expires:            false,
    payment_methods: {
      excluded_payment_methods: excludedMethods.map(id => ({ id })),
      excluded_payment_types:   [],
      installments:             installments,
    },
    metadata: { userId, planoKey, splitIndex, splitTotal },
  };

  const pref = await mpPost('/checkout/preferences', body);
  return {
    preferenceId: pref.id,
    initPoint:    pref.init_point,        // produção
    sandboxPoint: pref.sandbox_init_point, // sandbox
    valor,
  };
}

/**
 * Cria assinatura recorrente (Preapproval) para planos mensais.
 * MP cobra automaticamente todo mês no cartão salvo.
 */
async function criarAssinatura({ plano: planoKey, email, nome, cpf, userId }) {
  const cfg = PLANOS_CONFIG[planoKey];
  if (!cfg || !cfg.recorrente) throw new Error(`Plano ${planoKey} não é recorrente`);

  const body = {
    reason:            cfg.nome,
    auto_recurring: {
      frequency:       1,
      frequency_type:  'months',
      transaction_amount: cfg.valor,
      currency_id:     'BRL',
    },
    payer_email:       email,
    back_url:          `${BASE_URL}/#/checkout?plano=${planoKey}&status=assinatura`,
    notification_url:  WEBHOOK,
    external_reference: `${userId}|${planoKey}`,
    status:            'pending',
    metadata:          { userId, planoKey, cpf },
    // Assinaturas: somente cartão de crédito
    payment_methods_allowed: [
      { payment_type: 'credit_card' },
    ],
  };

  const sub = await mpPost('/preapproval', body);
  return {
    assinaturaId: sub.id,
    initPoint:    sub.init_point,
    status:       sub.status,
  };
}

async function verificar({ paymentId, assinaturaId }) {
  if (assinaturaId) {
    const s = await mpGet(`/preapproval/${assinaturaId}`);
    return { tipo: 'assinatura', status: s.status, dados: s };
  }
  const p = await mpGet(`/v1/payments/${paymentId}`);
  return { tipo: 'pagamento', status: p.status, statusDetalhe: p.status_detail, dados: p };
}

async function cancelarAssinatura({ assinaturaId, email }) {
  // Cancela a renovação automática. Se não vier o id da assinatura, busca os
  // preapprovals ativos do pagador por e-mail (espelha o fluxo do Asaas).
  let ids = [];
  if (assinaturaId) {
    ids = [assinaturaId];
  } else if (email) {
    try {
      const r = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`);
      ids = (r?.results || []).map(x => x.id).filter(Boolean);
    } catch (_) { ids = []; }
  }
  if (!ids.length) return { ok: true, cancelados: 0, nenhuma: true };
  let cancelados = 0;
  for (const id of ids) {
    try { await mpPut(`/preapproval/${id}`, { status: 'cancelled' }); cancelados++; } catch (_) {}
  }
  return { ok: true, cancelados };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  if (!TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado' }), { status: 500 });

  let user;
  try { user = await getAuthUser(req); } catch { /* getAuthUser retorna null em falha */ }
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  const { action, ...params } = body;
  // Segurança: o usuário do checkout é SEMPRE o autenticado (evita IDOR)
  params.userId = user.id;

  try {
    let result;
    switch (action) {
      case 'criar_preferencia':  result = await criarPreferencia(params);   break;
      case 'criar_assinatura':   result = await criarAssinatura(params);    break;
      case 'verificar':          result = await verificar(params);           break;
      case 'cancelar_assinatura': result = await cancelarAssinatura(params); break;
      default:
        return new Response(JSON.stringify({ error: `Action desconhecida: ${action}` }), { status: 400 });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(`[mp] action=${action}`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
