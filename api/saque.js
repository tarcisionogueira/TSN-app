/**
 * /api/saque — fluxo único de saldo e saque (razão saldo_lancamentos)
 *  GET            → extrato + saldo do próprio usuário
 *  GET ?todos=1   → admin: prestação de contas (todos os saldos + solicitações)
 *  POST {valor}   → solicita saque (reserva no ledger, status 'solicitado')
 *  PATCH ?id=X {acao:'pagar'|'recusar'} → admin: pagar (só sexta) ou recusar
 *
 * Substitui os fluxos paralelos (saques/mp_saques/saldos_profissionais).
 */
import { getAuthUser, unauthorized, forbidden } from './_auth.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });

async function db(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Chama uma função RPC do Postgres (service_role).
async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const roleFor = async (id) => (await db(`perfis?id=eq.${id}&select=role`)).data?.[0]?.role || null;
const saldoDe = async (id) => Number((await db(`saldo_usuarios?user_id=eq.${id}&select=saldo_disponivel`)).data?.[0]?.saldo_disponivel || 0);
// Sexta-feira no fuso America/Bahia
function ehSexta() {
  const dia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bahia' })).getDay();
  return dia === 5;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const url = new URL(req.url);
  const role = await roleFor(user.id);

  // ── GET ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (url.searchParams.get('todos') === '1') {
      if (role !== 'admin') return forbidden();
      const saldos = (await db('saldo_usuarios?select=*&order=saldo_disponivel.desc')).data || [];
      const pendentes = (await db("saldo_lancamentos?status=eq.solicitado&order=criado_em.asc&select=*")).data || [];
      return json({ saldos, pendentes });
    }
    const saldo = await saldoDe(user.id);
    const extrato = (await db(`saldo_lancamentos?user_id=eq.${user.id}&order=criado_em.desc&limit=200&select=*`)).data || [];
    return json({ saldo, extrato });
  }

  // ── POST: solicitar saque ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const valor = Math.round(Number(body.valor) * 100) / 100;
    if (!valor || valor <= 0) return json({ error: 'Valor inválido' }, 400);

    // Checagem de saldo/PIX + inserção do lançamento é ATÔMICA no banco
    // (serializada por usuário) — elimina a corrida read-then-write que
    // permitia dois saques simultâneos zerarem o mesmo saldo.
    const r = await rpc('solicitar_saque_ledger', { p_user_id: user.id, p_valor: valor });
    if (!r.ok) return json({ error: 'Erro ao solicitar saque', detail: r.data }, 500);
    if (!r.data?.ok) return json({ error: r.data?.error || 'Não foi possível solicitar o saque' }, 400);
    return json({ ok: true, saldo_restante: r.data.saldo_restante }, 201);
  }

  // ── PATCH: admin paga (só sexta) ou recusa ───────────────────────────────
  if (req.method === 'PATCH') {
    if (role !== 'admin') return forbidden();
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id obrigatório' }, 400);
    // id vai cru na query PostgREST (admin-only, mas validamos por higiene/defesa).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: 'id inválido' }, 400);
    let body; try { body = await req.json(); } catch { body = {}; }
    const acao = body.acao;

    if (acao === 'pagar') {
      if (!ehSexta()) return json({ error: 'Pagamentos de saque são processados apenas às sextas-feiras.' }, 422);
      const r = await db(`saldo_lancamentos?id=eq.${id}&status=eq.solicitado`, {
        method: 'PATCH', body: JSON.stringify({ status: 'sacado' }), headers: { Prefer: 'return=minimal' },
      });
      if (!r.ok) return json({ error: 'Erro ao marcar pago' }, 500);
      return json({ ok: true });
    }
    if (acao === 'recusar') {
      const r = await db(`saldo_lancamentos?id=eq.${id}&status=eq.solicitado`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelado' }), headers: { Prefer: 'return=minimal' },
      });
      if (!r.ok) return json({ error: 'Erro ao recusar' }, 500);
      return json({ ok: true });
    }
    return json({ error: 'acao inválida' }, 400);
  }

  return json({ error: 'Método não permitido' }, 405);
}
