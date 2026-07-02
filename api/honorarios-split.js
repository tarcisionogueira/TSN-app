/**
 * /api/honorarios-split — distribuição do êxito (10%) POR OPERAÇÃO (arrematação).
 * Só admin. A distribuição efetiva (crédito no ledger) roda em api/arrematacoes.js
 * quando o status vira 'finalizado' — usando este override quando existir.
 *
 *  GET  ?cliente_id=X          → arrematação em aberto do cliente + envolvidos
 *                                designados (sorteio/indicação) + config + equipe.
 *  POST { arrematacao_id, split } → salva honorarios_split { *_pct, *_id }.
 */
import { getAuthUser, unauthorized, forbidden } from './_auth.js';

export const config = { runtime: 'edge' };

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });

async function db(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}
const uuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const nomeDe = async (id) => id ? ((await db(`perfis?id=eq.${id}&select=nome`)).data?.[0]?.nome || null) : null;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if ((await db(`perfis?id=eq.${user.id}&select=role`)).data?.[0]?.role !== 'admin') return forbidden();

  if (req.method === 'GET') {
    const clienteId = new URL(req.url).searchParams.get('cliente_id');
    if (!uuid(clienteId)) return json({ error: 'cliente_id inválido' }, 400);

    const arr = (await db(`arrematacoes?cliente_id=eq.${clienteId}&honorarios_status=neq.distribuido&select=id,valor_arrematado,honorarios_status,honorarios_split,advogado_id,analista_id&order=criado_em.desc&limit=1`)).data?.[0] || null;
    const cfg = (await db('config_honorarios?id=eq.1&select=total_pct,admin_pct,advogado_pct,analista_pct,consultor_pct')).data?.[0]
      || { total_pct: 10, admin_pct: 4.5, advogado_pct: 5, analista_pct: 0.5, consultor_pct: 0 };
    const adminRow = (await db('perfis?role=eq.admin&ativo=eq.true&select=id,nome&order=criado_em.asc&limit=1')).data?.[0];

    // Consultor designado = quem captou o cliente (indicado_por), se for consultor.
    let consultorId = null;
    const cli = (await db(`perfis?id=eq.${clienteId}&select=indicado_por`)).data?.[0];
    if (cli?.indicado_por) {
      const ind = (await db(`perfis?id=eq.${cli.indicado_por}&select=id,role`)).data?.[0];
      if (ind?.role === 'consultor') consultorId = ind.id;
    }

    const split = arr?.honorarios_split || null;
    const envolvidos = {
      admin:     { id: adminRow?.id || null, nome: adminRow?.nome || 'Admin (backup)' },
      advogado:  { id: split?.advogado_id ?? arr?.advogado_id ?? null, nome: null },
      analista:  { id: split?.analista_id ?? arr?.analista_id ?? null, nome: null },
      consultor: { id: split?.consultor_id ?? consultorId, nome: null },
    };
    envolvidos.advogado.nome  = await nomeDe(envolvidos.advogado.id);
    envolvidos.analista.nome  = await nomeDe(envolvidos.analista.id);
    envolvidos.consultor.nome = await nomeDe(envolvidos.consultor.id);

    const equipe = (await db('perfis?role=in.(advogado,analista,consultor)&ativo=eq.true&select=id,nome,role&order=nome.asc')).data || [];
    return json({
      arrematacao: arr ? { id: arr.id, valor: Number(arr.valor_arrematado || 0), status: arr.honorarios_status } : null,
      config: cfg, split, envolvidos,
      equipe: {
        advogados:   equipe.filter(e => e.role === 'advogado'),
        analistas:   equipe.filter(e => e.role === 'analista'),
        consultores: equipe.filter(e => e.role === 'consultor'),
      },
    });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const { arrematacao_id, split } = body;
    if (!uuid(arrematacao_id) || !split || typeof split !== 'object') return json({ error: 'arrematacao_id e split obrigatórios' }, 400);
    const pct = k => Math.max(0, Number(split[k]) || 0);
    const soma = pct('admin_pct') + pct('advogado_pct') + pct('analista_pct') + pct('consultor_pct');
    const cfg = (await db('config_honorarios?id=eq.1&select=total_pct')).data?.[0];
    const total = Number(split.total_pct) || Number(cfg?.total_pct) || 10;
    if (Math.abs(soma - total) > 0.01) return json({ error: `A soma (${soma.toFixed(2)}%) deve ser igual ao total (${total.toFixed(2)}%).` }, 400);

    const clean = {
      total_pct: total,
      admin_pct: pct('admin_pct'), advogado_pct: pct('advogado_pct'), analista_pct: pct('analista_pct'), consultor_pct: pct('consultor_pct'),
      advogado_id: uuid(split.advogado_id) ? split.advogado_id : null,
      analista_id: uuid(split.analista_id) ? split.analista_id : null,
      consultor_id: uuid(split.consultor_id) ? split.consultor_id : null,
    };
    const r = await db(`arrematacoes?id=eq.${encodeURIComponent(arrematacao_id)}&honorarios_status=neq.distribuido`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ honorarios_split: clean }),
    });
    if (!r.ok) return json({ error: 'Erro ao salvar', detail: r.data }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Método não permitido' }, 405);
}
