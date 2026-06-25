export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  // Valida autenticação — rejeita requisições sem token válido
  const authUser = await getAuthUser(req);
  if (!authUser?.id) return unauthorized();

  const { user_id, produto_tipo, produto_id, valor, ref_codigo } = await req.json();

  if (!user_id || !produto_tipo || !produto_id) {
    return new Response(JSON.stringify({ error: 'Dados incompletos' }), { status: 400, headers });
  }

  // Garante que o usuário autenticado só pode registrar compra para si mesmo
  if (authUser.id !== user_id) {
    return new Response(JSON.stringify({ error: 'Ação não permitida' }), { status: 403, headers });
  }

  // Verifica se já existe compra ativa para evitar duplicata
  const rc = await sb(`compras_produtos?user_id=eq.${user_id}&produto_tipo=eq.${produto_tipo}&produto_id=eq.${produto_id}&status=eq.ativo&select=id`);
  const existentes = await rc.json();
  if (Array.isArray(existentes) && existentes.length > 0) {
    return new Response(JSON.stringify({ ok: true, duplicata: true }), { status: 200, headers });
  }

  // Registra a compra
  const ri = await sb('compras_produtos', {
    method: 'POST',
    body: JSON.stringify({ user_id, produto_tipo, produto_id, valor: Number(valor) || 0, status: 'ativo' }),
    headers: { Prefer: 'return=representation' },
  });
  const inserido = await ri.json();

  // Vincula indicação se vier com ref do consultor
  if (ref_codigo) {
    try {
      await sb('rpc/vincular_indicacao_compra', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: user_id, p_codigo: ref_codigo, p_produto_tipo: produto_tipo, p_produto_id: produto_id }),
      });
    } catch (_) {}
  }

  return new Response(JSON.stringify({ ok: true, compra: inserido }), { status: 200, headers });
}
