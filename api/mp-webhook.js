/**
 * POST /api/mp-webhook
 * Recebe notificações do Mercado Pago (IPN / Webhooks).
 * Confirma pagamentos, ativa assinaturas, registra saques.
 *
 * MP envia: { type, data: { id } } ou query param id + topic
 */

export const config = { runtime: 'edge' };

const MP_URL        = 'https://api.mercadopago.com';
const TOKEN         = (process.env.MP_ACCESS_TOKEN || '').trim();
const WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || '').trim();
const SUPABASE      = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

/** Valida assinatura HMAC-SHA256 do MP (header x-signature) */
async function validarAssinatura(req, rawBody) {
  if (!WEBHOOK_SECRET) return true; // sem secret configurado, aceita (não recomendado em prod)
  const xSignature = req.headers.get('x-signature') || '';
  const xRequestId = req.headers.get('x-request-id') || '';
  const { searchParams } = new URL(req.url);
  const dataId = searchParams.get('data.id') || '';

  // MP monta o template: ts=<ts>&v1=<hash>
  // e o manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
  const parts = Object.fromEntries(xSignature.split(',').map(p => p.trim().split('=')));
  const ts = parts['ts'] || '';
  const v1 = parts['v1'] || '';
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === v1;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function mpGet(path) {
  const res = await fetch(`${MP_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) return null;
  return res.json();
}

async function sbPost(table, row) {
  return fetch(`${SUPABASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

async function sbPatch(table, filter, row) {
  return fetch(`${SUPABASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

async function sbGet(table, filter) {
  const res = await fetch(`${SUPABASE}/rest/v1/${table}?${filter}&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0] || null;
}

// Extrai userId e planoKey do external_reference ("userId|planoKey" ou "userId|planoKey|split...")
function parseRef(ref = '') {
  const [userId, planoKey] = ref.split('|');
  return { userId: userId || null, planoKey: planoKey || null };
}

// ─── Processadores ───────────────────────────────────────────────────────────

async function processarPagamento(paymentId) {
  const p = await mpGet(`/v1/payments/${paymentId}`);
  if (!p) return;

  const { userId, planoKey } = parseRef(p.external_reference);
  if (!userId) return;

  const aprovado = p.status === 'approved';

  // Upsert em mp_pagamentos
  await sbPost('mp_pagamentos', {
    mp_payment_id:    String(paymentId),
    user_id:          userId,
    plano_key:        planoKey,
    valor:            p.transaction_amount,
    status:           p.status,
    status_detalhe:   p.status_detail,
    metodo:           p.payment_type_id,
    external_ref:     p.external_reference,
    dados_mp:         p,
    atualizado_em:    new Date().toISOString(),
  }).catch(() => {
    // Se já existe, atualiza
    sbPatch('mp_pagamentos', `mp_payment_id=eq.${paymentId}`, {
      status:        p.status,
      status_detalhe: p.status_detail,
      atualizado_em: new Date().toISOString(),
    });
  });

  if (!aprovado || !planoKey) return;

  // Plano split: verifica se todas as partes foram pagas
  if (p.external_reference?.includes('split')) {
    await verificarSplitCompleto(userId, planoKey, p.external_reference);
    return;
  }

  await ativarPlano(userId, planoKey, { mp_payment_id: String(paymentId) });
}

async function processarAssinatura(assinaturaId) {
  const s = await mpGet(`/preapproval/${assinaturaId}`);
  if (!s) return;

  const { userId, planoKey } = parseRef(s.external_reference);
  if (!userId) return;

  await sbPost('mp_assinaturas', {
    mp_assinatura_id: String(assinaturaId),
    user_id:          userId,
    plano_key:        planoKey,
    status:           s.status,
    dados_mp:         s,
    atualizado_em:    new Date().toISOString(),
  }).catch(() => {
    sbPatch('mp_assinaturas', `mp_assinatura_id=eq.${assinaturaId}`, {
      status:        s.status,
      atualizado_em: new Date().toISOString(),
    });
  });

  if (s.status === 'authorized') {
    await ativarPlano(userId, planoKey, { mp_assinatura_id: String(assinaturaId) });
  }
  if (s.status === 'cancelled' || s.status === 'paused') {
    await desativarPlano(userId, planoKey);
  }
}

async function verificarSplitCompleto(userId, planoKey, extRef) {
  // Extrai "split1of2" → total = 2
  const m = extRef.match(/split\d+of(\d+)/);
  if (!m) return;
  const total = Number(m[1]);

  // Conta pagamentos aprovados deste usuário/plano com split
  const res = await fetch(
    `${SUPABASE}/rest/v1/mp_pagamentos?user_id=eq.${userId}&plano_key=eq.${planoKey}&status=eq.approved&external_ref=like.*split*`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const pagos = await res.json();
  if ((pagos?.length || 0) >= total) {
    await ativarPlano(userId, planoKey, { mp_split: true });
  }
}

async function ativarPlano(userId, planoKey, extra = {}) {
  // Determina acesso e fidelidade por plano
  const PLANO_CFG = {
    assessorado: { acesso_dias: 365, role: null },
    clube:       { acesso_dias: 30,  role: 'clube' },
    top1:        { acesso_dias: 30,  role: 'top1' },
    top2:        { acesso_dias: 30,  role: 'top2' },
  };
  const cfg = PLANO_CFG[planoKey] || { acesso_dias: 30, role: null };
  const acesso_fim = new Date(Date.now() + cfg.acesso_dias * 86400000).toISOString();

  // Atualiza perfil
  await sbPatch('perfis', `id=eq.${userId}`, {
    plano:         planoKey,
    plano_ativo:   true,
    plano_ativado_em: new Date().toISOString(),
    acesso_fim,
    ...(cfg.role ? { role: cfg.role } : {}),
    ...extra,
  });

  // Registra em plano_assinaturas
  await sbPost('plano_assinaturas', {
    user_id:        userId,
    plano_key:      planoKey,
    status:         'ativo',
    acesso_fim,
    ativado_em:     new Date().toISOString(),
    mp_payment_id:  extra.mp_payment_id || null,
    mp_assinatura_id: extra.mp_assinatura_id || null,
  }).catch(() => {
    sbPatch('plano_assinaturas', `user_id=eq.${userId}&plano_key=eq.${planoKey}`, {
      status: 'ativo', acesso_fim, atualizado_em: new Date().toISOString(),
    });
  });
}

async function desativarPlano(userId, planoKey) {
  await sbPatch('perfis', `id=eq.${userId}`, { plano_ativo: false });
  await sbPatch('plano_assinaturas', `user_id=eq.${userId}&plano_key=eq.${planoKey}`, {
    status: 'cancelado', atualizado_em: new Date().toISOString(),
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'GET') return new Response('ok', { status: 200 }); // MP valida com GET

  // Lê o body como texto para validar assinatura antes de parsear
  const rawBody = await req.text();
  let body = {};
  try { body = JSON.parse(rawBody); } catch {}

  // Valida assinatura HMAC — rejeita notificações não autorizadas
  const assinaturaValida = await validarAssinatura(req, rawBody);
  if (!assinaturaValida) {
    console.warn('[mp-webhook] assinatura inválida — ignorado');
    return new Response('unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  // MP envia type via body ou query
  const type = body.type || searchParams.get('topic');
  const id   = body.data?.id || searchParams.get('id');

  if (!type || !id) return new Response('ok', { status: 200 });

  try {
    if (type === 'payment') {
      await processarPagamento(id);
    } else if (type === 'preapproval' || type === 'subscription_preapproval') {
      await processarAssinatura(id);
    }
    // Outros tipos (merchant_order, etc.) ignorados
  } catch (err) {
    console.error('[mp-webhook]', type, id, err.message);
    // Retorna 200 mesmo em erro para o MP não ficar reenviando em loop
  }

  return new Response('ok', { status: 200 });
}
