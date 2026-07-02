/**
 * /api/honorarios-split — êxito (honorários) no modelo POR USUÁRIO. Só admin.
 *
 * O % de cada membro da equipe é individual (perfis.honorario_exito_pct); o admin
 * sempre equilibra (admin = total − soma dos envolvidos). A mudança vale só para
 * vendas finalizadas DEPOIS — nunca retroage (ver api/_honorarios.js). A distribuição
 * efetiva no ledger roda em api/arrematacoes.js quando a arrematação vira 'finalizado'.
 *
 *  GET ?equipe=1              → membros (advogado/analista/consultor) + % individual
 *                               e o padrão do papel (config_honorarios). Editor de Usuários.
 *  GET ?arrematacao_id=X      → monitor de UMA venda: envolvidos, %s e R$ a distribuir.
 *  GET ?cliente_id=X          → idem, achando a arrematação em aberto do cliente.
 *  POST { user_id, pct }      → define o % individual do membro (pct null → volta ao padrão).
 */
import { getAuthUser, unauthorized, forbidden } from './_auth.js';
import { calcularDistribuicao } from './_honorarios.js';

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

// Monta o "monitor" de uma venda a partir da arrematação: se já distribuída,
// mostra o SNAPSHOT do que foi pago; senão, a projeção atual.
async function monitorDaArrematacao(arr) {
  if (!arr) return null;
  const distribuido = arr.honorarios_status === 'distribuido';
  const snap = distribuido && arr.honorarios_split && Array.isArray(arr.honorarios_split.linhas) ? arr.honorarios_split : null;
  const dist = snap
    ? { total: Number(snap.total_pct) || 10, valor: Number(arr.valor_arrematado || 0), linhas: snap.linhas }
    : await calcularDistribuicao(db, arr);
  return {
    arrematacao: { id: arr.id, valor: Number(arr.valor_arrematado || 0), status: arr.honorarios_status || 'pendente' },
    distribuido, total_pct: dist.total, linhas: dist.linhas,
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if ((await db(`perfis?id=eq.${user.id}&select=role`)).data?.[0]?.role !== 'admin') return forbidden();

  if (req.method === 'GET') {
    const sp = new URL(req.url).searchParams;

    // Editor de Usuários: equipe + % individual e padrão do papel.
    if (sp.get('equipe') === '1') {
      const cfg = (await db('config_honorarios?id=eq.1&select=total_pct,advogado_pct,analista_pct,consultor_pct')).data?.[0]
        || { total_pct: 10, advogado_pct: 5, analista_pct: 0.5, consultor_pct: 0 };
      const padrao = { advogado: Number(cfg.advogado_pct) || 0, analista: Number(cfg.analista_pct) || 0, consultor: Number(cfg.consultor_pct) || 0 };
      const membros = (await db('perfis?role=in.(advogado,analista,consultor)&ativo=eq.true&select=id,nome,role,honorario_exito_pct&order=role.asc,nome.asc')).data || [];
      return json({
        total_pct: Number(cfg.total_pct) || 10,
        padrao,
        membros: membros.map(m => ({
          id: m.id, nome: m.nome, role: m.role,
          pct_individual: m.honorario_exito_pct == null ? null : Number(m.honorario_exito_pct),
          pct_efetivo: m.honorario_exito_pct == null ? (padrao[m.role] || 0) : Number(m.honorario_exito_pct),
        })),
      });
    }

    // Monitor por arrematação.
    const arrId = sp.get('arrematacao_id');
    if (arrId) {
      if (!uuid(arrId)) return json({ error: 'arrematacao_id inválido' }, 400);
      const arr = (await db(`arrematacoes?id=eq.${arrId}&select=id,valor_arrematado,honorarios_status,honorarios_split,advogado_id,analista_id,arrematante_id`)).data?.[0];
      if (!arr) return json({ error: 'Arrematação não encontrada' }, 404);
      return json(await monitorDaArrematacao(arr) || {});
    }

    // Monitor pela arrematação em aberto do cliente (arrematante).
    const clienteId = sp.get('cliente_id');
    if (clienteId) {
      if (!uuid(clienteId)) return json({ error: 'cliente_id inválido' }, 400);
      const arr = (await db(`arrematacoes?arrematante_id=eq.${clienteId}&select=id,valor_arrematado,honorarios_status,honorarios_split,advogado_id,analista_id,arrematante_id&order=criado_em.desc&limit=1`)).data?.[0] || null;
      return json({ monitor: await monitorDaArrematacao(arr) });
    }

    return json({ error: 'Informe equipe=1, arrematacao_id ou cliente_id' }, 400);
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const { user_id } = body;
    if (!uuid(user_id)) return json({ error: 'user_id inválido' }, 400);

    // Só membros de equipe têm % individual (o admin é sempre o saldo).
    const alvo = (await db(`perfis?id=eq.${user_id}&select=id,role`)).data?.[0];
    if (!alvo || !['advogado', 'analista', 'consultor'].includes(alvo.role)) {
      return json({ error: 'Só advogado, analista ou consultor têm % individual (o admin recebe o saldo).' }, 400);
    }

    // pct null/'' → limpa (volta ao padrão do papel). Senão 0 ≤ pct ≤ total.
    let pct = body.pct;
    if (pct === null || pct === '' || pct === undefined) {
      pct = null;
    } else {
      pct = Number(pct);
      const total = Number((await db('config_honorarios?id=eq.1&select=total_pct')).data?.[0]?.total_pct) || 10;
      if (isNaN(pct) || pct < 0 || pct > total) return json({ error: `O % deve ficar entre 0 e ${total}.` }, 400);
    }

    const r = await db(`perfis?id=eq.${user_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ honorario_exito_pct: pct }) });
    if (!r.ok) return json({ error: 'Erro ao salvar', detail: r.data }, 500);
    return json({ ok: true, pct });
  }

  return json({ error: 'Método não permitido' }, 405);
}
