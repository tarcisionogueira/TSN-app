/**
 * GET  /api/admin-assessorados   — lista clientes do plano "assessorado" com seus casos/arremates.
 *   admin: vê TODOS. analista/advogado/consultor: vê só quem foi DESIGNADO a eles
 *   (assessorado_designacao). Qualquer outro role: 403.
 * POST /api/admin-assessorados   — admin apenas. Body: { cliente_id, membro_id, acao }
 *   acao: 'designar' | 'remover'. Gerencia quem da equipe acompanha qual cliente.
 *
 * Pedido do dono (22/09): menu dedicado pra ver a lista de assessorados e ir direto pros
 * arremates deles (cada caso já linka pra /caso/:id, que tem upload de anexo e monitoramento).
 */
export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ROLES_EQUIPE = ['analista', 'advogado', 'consultor'];

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
async function sbJson(path, opts) {
  const r = await sb(path, opts);
  if (!r.ok) { console.error('[admin-assessorados] consulta falhou', path, r.status); return []; }
  return r.json();
}

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && !ROLES_EQUIPE.includes(role)) return forbidden('Sem permissão');

  if (req.method === 'GET') {
    let clienteIds;
    let equipe = undefined;
    if (role === 'admin') {
      const [assessorados, membros] = await Promise.all([
        sbJson(`perfis?role=eq.assessorado&select=id&order=nome.asc`),
        sbJson(`perfis?role=in.(${ROLES_EQUIPE.join(',')})&select=id,nome,role&order=nome.asc`),
      ]);
      clienteIds = assessorados.map((p) => p.id);
      equipe = membros;
    } else {
      const designados = await sbJson(`assessorado_designacao?membro_id=eq.${user.id}&select=cliente_id`);
      clienteIds = [...new Set(designados.map((d) => d.cliente_id))];
    }
    if (!clienteIds.length) return json({ pode_designar: role === 'admin', clientes: [], equipe });

    const [perfis, casos, designacoes] = await Promise.all([
      sbJson(`perfis?id=in.(${clienteIds.join(',')})&select=id,nome,telefone,role&order=nome.asc`),
      sbJson(`casos?cliente_id=in.(${clienteIds.join(',')})&select=id,cliente_id,imovel_id,imovel_endereco,status_etapa,arrematado_em,juridico_status,created_at&order=created_at.desc`),
      role === 'admin' ? sbJson(`assessorado_designacao?cliente_id=in.(${clienteIds.join(',')})&select=cliente_id,membro_id`) : Promise.resolve([]),
    ]);

    let nomeMembro = {};
    if (role === 'admin' && designacoes.length) {
      const membroIds = [...new Set(designacoes.map((d) => d.membro_id))];
      const membros = await sbJson(`perfis?id=in.(${membroIds.join(',')})&select=id,nome`);
      nomeMembro = Object.fromEntries(membros.map((m) => [m.id, m.nome]));
    }

    const clientes = perfis.map((p) => ({
      id: p.id, nome: p.nome, telefone: p.telefone,
      casos: casos.filter((c) => c.cliente_id === p.id).map((c) => ({
        id: c.id, imovel_endereco: c.imovel_endereco, status_etapa: c.status_etapa,
        arrematado_em: c.arrematado_em, juridico_status: c.juridico_status,
      })),
      equipe_designada: role === 'admin'
        ? designacoes.filter((d) => d.cliente_id === p.id).map((d) => ({ membro_id: d.membro_id, nome: nomeMembro[d.membro_id] || d.membro_id }))
        : undefined,
    }));

    return json({ pode_designar: role === 'admin', clientes, equipe });
  }

  if (req.method === 'POST') {
    if (role !== 'admin') return forbidden('Apenas administradores designam equipe');
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const { cliente_id, membro_id, acao } = b || {};
    const isUUID = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
    if (!isUUID(cliente_id) || !isUUID(membro_id)) return json({ error: 'cliente_id e membro_id devem ser UUID' }, 400);
    if (!['designar', 'remover'].includes(acao)) return json({ error: 'acao deve ser designar ou remover' }, 400);

    const [cliente, membro] = await Promise.all([
      sbJson(`perfis?id=eq.${cliente_id}&select=role`),
      sbJson(`perfis?id=eq.${membro_id}&select=role`),
    ]);
    if (cliente[0]?.role !== 'assessorado') return json({ error: 'cliente_id não é um assessorado' }, 400);
    if (!ROLES_EQUIPE.includes(membro[0]?.role)) return json({ error: 'membro_id precisa ser analista, advogado ou consultor' }, 400);

    if (acao === 'designar') {
      const r = await sb('assessorado_designacao?on_conflict=cliente_id,membro_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { cliente_id, membro_id, designado_por: user.id },
      });
      if (!r.ok) return json({ error: 'Falha ao designar' }, 500);
    } else {
      const r = await sb(`assessorado_designacao?cliente_id=eq.${cliente_id}&membro_id=eq.${membro_id}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: 'Falha ao remover designação' }, 500);
    }
    return json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405 });
}
