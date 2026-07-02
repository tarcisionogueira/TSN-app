/**
 * POST /api/ajuste-saldo — o ADMIN credita/debita a comissão de um usuário no
 * ledger unificado (saldo_lancamentos). Ajuste individual, com motivo obrigatório.
 * Valor positivo credita; negativo debita. Só admin. Entra no mesmo saldo que o
 * usuário saca — auditável (fica no extrato com o motivo).
 *
 * Body: { user_id, valor, motivo }
 */
import { getAuthUser, unauthorized, forbidden } from './_auth.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });

async function db(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const role = (await db(`perfis?id=eq.${user.id}&select=role`)).data?.[0]?.role;
  if (role !== 'admin') return forbidden();

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const userId = String(body.user_id || '').trim();
  const valor  = Math.round(Number(body.valor) * 100) / 100;
  const motivo = String(body.motivo || '').trim().slice(0, 300);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'user_id inválido' }, 400);
  if (!valor || isNaN(valor)) return json({ error: 'Valor inválido (use negativo para debitar)' }, 400);
  if (!motivo) return json({ error: 'Informe o motivo do ajuste' }, 400);

  const alvo = (await db(`perfis?id=eq.${userId}&select=id,nome`)).data?.[0];
  if (!alvo) return json({ error: 'Usuário não encontrado' }, 404);

  const sinal = valor > 0 ? 'crédito' : 'débito';
  const r = await db('saldo_lancamentos', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId, tipo: 'ajuste_comissao', valor,
      descricao: `Ajuste de comissão (${sinal}, admin): ${motivo}`, status: 'disponivel',
    }),
  });
  if (!r.ok) return json({ error: 'Erro ao registrar ajuste', detail: r.data }, 500);
  return json({ ok: true }, 201);
}
