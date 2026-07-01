/**
 * GET /api/mp-diag  (somente admin)
 * Diagnóstico ao vivo da conta Mercado Pago usando o token do servidor.
 * Responde de forma definitiva:
 *  - o token é de PRODUÇÃO (APP_USR-) ou de TESTE (TEST-)?
 *  - a conta (users/me) que o token resolve
 *  - existe assinatura (preapproval) para um e-mail? (?email=...)
 *  - últimos pagamentos e o saldo disponível
 *
 * Sem tocar em nada — apenas leitura. Abra logado como admin:
 *   /api/mp-diag?email=email-da-neuma@...
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';

const MP_URL = 'https://api.mercadopago.com';
const TOKEN  = (process.env.MP_ACCESS_TOKEN || '').trim();

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
});

async function mpGet(path) {
  try {
    const res = await fetch(`${MP_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, erro: e.message };
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const user = await getAuthUser(req).catch(() => null);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id).catch(() => null);
  if (role !== 'admin') return json({ error: 'Somente admin' }, 403);

  if (!TOKEN) return json({ error: 'MP_ACCESS_TOKEN não configurado no Vercel' }, 500);

  const url   = new URL(req.url);
  const email = (url.searchParams.get('email') || '').trim();

  // Tipo do token — o sinal mais decisivo de "por que não caiu dinheiro".
  const tipoToken = TOKEN.startsWith('APP_USR-') ? 'PRODUCAO'
    : TOKEN.startsWith('TEST-') ? 'TESTE'
    : 'DESCONHECIDO';

  // Conta que o token resolve.
  const me = await mpGet('/users/me');

  // Assinaturas (preapproval) do e-mail informado — é AQUI que o Investidor Pro
  // aparece (não em "Vendas").
  let assinaturas = null;
  if (email) {
    const r = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(email)}`);
    assinaturas = r.ok
      ? (r.data?.results || []).map(a => ({
          id: a.id, status: a.status, reason: a.reason,
          valor: a.auto_recurring?.transaction_amount,
          external_reference: a.external_reference,
          date_created: a.date_created, last_charged: a.summarized?.last_charged_date,
        }))
      : { erro: r.status, data: r.data };
  }

  // Últimos pagamentos da conta (se houver cobrança real, aparece aqui).
  const pagamentos = await mpGet('/v1/payments/search?sort=date_created&criteria=desc&limit=5');
  const ultimosPagamentos = pagamentos.ok
    ? (pagamentos.data?.results || []).map(p => ({
        id: p.id, status: p.status, status_detail: p.status_detail,
        valor: p.transaction_amount, email: p.payer?.email,
        metodo: p.payment_method_id, live_mode: p.live_mode,
        external_reference: p.external_reference, date_created: p.date_created,
      }))
    : { erro: pagamentos.status, data: pagamentos.data };

  // Saldo disponível.
  const saldo = me.ok && me.data?.id
    ? await mpGet(`/users/${me.data.id}/mercadopago_account/balance`)
    : { ok: false, nota: 'sem user id' };

  return json({
    diagnostico: {
      tipo_token: tipoToken,
      veredito: tipoToken === 'TESTE'
        ? '⚠️ Token de TESTE — pagamentos "aprovam" mas NÃO cobram de verdade e não aparecem na conta real. Troque por APP_USR- no Vercel.'
        : tipoToken === 'PRODUCAO'
          ? 'Token de produção. Se não há venda/assinatura abaixo, o problema foi na criação (ver assinaturas/erros).'
          : 'Token com prefixo desconhecido — verifique o valor no Vercel.',
    },
    conta_mp: me.ok ? {
      id: me.data?.id, nickname: me.data?.nickname, email: me.data?.email,
      site_id: me.data?.site_id, tipo: me.data?.user_type,
    } : { erro: me.status, data: me.data },
    assinaturas_do_email: assinaturas,
    ultimos_pagamentos: ultimosPagamentos,
    saldo: saldo.ok ? saldo.data : { indisponivel: saldo.status || saldo.nota, data: saldo.data },
  });
}
