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
      // GET /v1/account/balance
      const data = await mpGet('/v1/account/balance');
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
