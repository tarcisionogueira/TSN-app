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
import { cpfDoRegistro } from './_cpf.js';

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

// ─── Ativação inline (Edge) ─────────────────────────────────────────────────────
// O webhook do MP nem sempre dispara/chega a tempo (config do painel, latência).
// No fluxo transparente o cliente fica autenticado aqui, então ativamos o role na
// hora via PostgREST — mesma semântica de ativarPlanoDireto (_webhook-core.js), mas
// sem arrastar deps Node (_nfse) para o bundle Edge. O TIER mora em `role`; NÃO
// gravar em `plano` (check constraint gratuito|analista|gestor). Idempotente.
const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

async function ativarRoleInline(userId, planoKey, mpId) {
  if (!SB_URL || !SB_KEY || !userId || !planoKey) return { skipped: true };
  const res = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey:          SB_KEY,
      Authorization:   `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal',
    },
    // Grava o id do preapproval (mp_id): sem ele não dá para rastrear/gerenciar a
    // recorrência por usuário nem cancelar pelo id (só por e-mail). plano_pago_em/
    // ciclo marcam a assinatura ativa.
    body: JSON.stringify({ role: planoKey, inadimplente_desde: null, role_anterior: null,
      ...(mpId ? { mp_id: String(mpId), plano_pago_em: new Date().toISOString(), plano_ciclo: 'mensal' } : {}) }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ativarRoleInline falhou (${res.status}): ${txt}`);
  }
  // Registra o preço contratado (para a renovação cobrar o valor vigente).
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/registrar_preco_contratado`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_plano_key: planoKey }),
    });
  } catch (_) { /* preço é best-effort; não bloqueia a ativação */ }
  return { ok: true };
}

// ─── Configurações de plano ───────────────────────────────────────────────────

const PLANOS_CONFIG = {
  assessorado:       { nome: 'Assessoria Pós-Arrematação',  valor: 5000.00, recorrente: false },
  assessorado_vista: { nome: 'Assessoria (À Vista)',         valor: 4800.00, recorrente: false },
  clube:             { nome: 'Leilão Club — Mensal',         valor: 5000.00, recorrente: true  },
  clube_vista:       { nome: 'Leilão Club (12× Anual)',      valor: 5000.00, recorrente: false },
  top2:              { nome: 'Investidor Pro',               valor: 49.90,  recorrente: true  },
  top2_anual:        { nome: 'Investidor Pro (Anual)',       valor: 449.90, recorrente: false },
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

/**
 * Cria assinatura recorrente TRANSPARENTE (sem redirect): recebe o card_token_id
 * tokenizado no browser (SDK do MP) e cria o preapproval já autorizado. O cliente
 * nunca sai do BidPro. Preço SEMPRE do servidor (PLANOS_CONFIG), nunca do cliente.
 */
async function criarAssinaturaTransparente({ plano: planoKey, email, cardTokenId, userId }) {
  const cfg = PLANOS_CONFIG[planoKey];
  if (!cfg || !cfg.recorrente) throw new Error(`Plano ${planoKey} não é recorrente`);
  if (!cardTokenId) throw new Error('Token do cartão ausente');
  if (!email) throw new Error('E-mail do pagador ausente');

  const body = {
    reason:             cfg.nome,
    external_reference: `${userId}|${planoKey}`,
    payer_email:        email,
    card_token_id:      cardTokenId,
    // 'authorized' + card_token_id = autoriza e cobra JÁ pelo cartão tokenizado
    // (fluxo transparente, sem init_point/redirect).
    status:             'authorized',
    back_url:           `${BASE_URL}/#/checkout?plano=${planoKey}&status=assinatura`,
    notification_url:   WEBHOOK,
    auto_recurring: {
      frequency:          1,
      frequency_type:     'months',
      transaction_amount: Number(cfg.valor), // servidor manda no preço
      currency_id:        'BRL',
    },
  };

  const sub = await mpPost('/preapproval', body);

  // MP autorizou/cobrou já (status 'authorized') → ativa o plano AGORA, sem
  // depender do webhook. Se a ativação falhar, não derruba o pagamento (o
  // webhook/reconciliação recupera): loga e segue.
  let ativado = false;
  if (sub.status === 'authorized') {
    try { await ativarRoleInline(userId, planoKey, sub.id); ativado = true; }
    catch (e) { console.error('[mp] ativação inline falhou:', e.message); }
  }
  return { assinaturaId: sub.id, status: sub.status, ativado };
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
  // CPF SEMPRE do perfil autenticado (decifra o cpf_enc; não confia no body).
  try {
    const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const r = await fetch(`${SB}/rest/v1/perfis?id=eq.${user.id}&select=cpf,cpf_enc`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (r.ok) { const [row] = await r.json(); const dec = await cpfDoRegistro(row); if (dec) params.cpf = dec; }
  } catch { /* mantém params.cpf do body como fallback */ }

  try {
    let result;
    switch (action) {
      case 'criar_preferencia':  result = await criarPreferencia(params);   break;
      case 'criar_assinatura':   result = await criarAssinatura(params);    break;
      case 'criar_assinatura_transparente': result = await criarAssinaturaTransparente(params); break;
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
