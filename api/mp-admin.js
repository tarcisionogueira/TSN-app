/**
 * POST /api/mp-admin
 * Endpoints internos para o painel admin (saldo, listagem de pagamentos).
 * Requer role=admin.
 */

export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const MP_URL      = 'https://api.mercadopago.com';
const TOKEN       = (process.env.MP_ACCESS_TOKEN || '').trim();
const SUPABASE    = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function isAdmin(userId) {
  const res = await fetch(`${SUPABASE}/rest/v1/perfis?id=eq.${userId}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0]?.role === 'admin';
}

async function mpGet(path) {
  const res = await fetch(`${MP_URL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) { const d = await res.json(); throw new Error(d.message || `MP ${res.status}`); }
  return res.json();
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // getAuthUser retorna null (não lança); sem este guard, isAdmin(user.id) quebra
  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  if (!(await isAdmin(user.id))) {
    return new Response(JSON.stringify({ error: 'Acesso negado' }), { status: 403 });
  }

  if (!TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (body.action === 'saldo') {
      // O MP NÃO tem /v1/account/balance (retorna a página genérica de devs em
      // espanhol). O saldo vem de /users/{id}/mercadopago_account/balance.
      try {
        const me = await mpGet('/users/me');
        const bal = await mpGet(`/users/${me.id}/mercadopago_account/balance`);
        return new Response(JSON.stringify({
          available_balance:   Number(bal.available_balance ?? bal.available ?? 0),
          unavailable_balance: Number(bal.unavailable_balance ?? bal.unavailable ?? 0),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        // Algumas contas MP não expõem saldo pela API. Mensagem limpa (não o texto
        // cru do MP) para o painel não assustar com erro em espanhol.
        return new Response(JSON.stringify({
          indisponivel: true,
          error: 'O Mercado Pago não expõe o saldo desta conta pela API. Consulte o saldo direto no painel do Mercado Pago.',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (body.action === 'transacoes') {
      // Fonte de verdade REAL: pagamentos direto na API do MP (não o nosso banco).
      // Mostra o valor da operação: bruto, taxa do MP e líquido efetivamente
      // recebido — o número que de fato entra na conta.
      const limit = Math.min(Number(body.limit) || 30, 50);
      const search = await mpGet(`/v1/payments/search?sort=date_created&criteria=desc&limit=${limit}`);
      const results = Array.isArray(search?.results) ? search.results : [];
      const tx = results.map((p) => {
        const bruto = Number(p.transaction_amount || 0);
        const liquido = p.transaction_details?.net_received_amount != null
          ? Number(p.transaction_details.net_received_amount)
          : null;
        const taxa = liquido != null
          ? Math.max(0, Number((bruto - liquido).toFixed(2)))
          : (Array.isArray(p.fee_details) ? p.fee_details.reduce((s, f) => s + Number(f.amount || 0), 0) : null);
        return {
          id: String(p.id),
          status: p.status,
          status_detail: p.status_detail || null,
          bruto,
          liquido,
          taxa,
          data: p.date_approved || p.date_created || null,
          email: p.payer?.email || null,
          descricao: p.description || '',
          metodo: p.payment_method_id || null,
          parcelas: p.installments || null,
        };
      });
      const aprovados = tx.filter((t) => t.status === 'approved');
      const totalBruto = aprovados.reduce((s, t) => s + t.bruto, 0);
      const totalLiquido = aprovados.reduce((s, t) => s + (t.liquido ?? t.bruto), 0);
      return new Response(JSON.stringify({
        transacoes: tx,
        resumo: {
          qtdAprovados: aprovados.length,
          totalBruto: Number(totalBruto.toFixed(2)),
          totalLiquido: Number(totalLiquido.toFixed(2)),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (body.action === 'pagamentos') {
      // Últimos pagamentos do Supabase
      const res = await fetch(
        `${SUPABASE}/rest/v1/mp_pagamentos?order=criado_em.desc&limit=50`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const data = await res.json();
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Action desconhecida' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
