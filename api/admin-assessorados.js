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
      sbJson(`casos?cliente_id=in.(${clienteIds.join(',')})&select=id,cliente_id,imovel_id,imovel_endereco,status_etapa,arrematado_em,posse_em,juridico_status,created_at&order=created_at.desc`),
      role === 'admin' ? sbJson(`assessorado_designacao?cliente_id=in.(${clienteIds.join(',')})&select=cliente_id,membro_id`) : Promise.resolve([]),
    ]);

    // Resultado do leilão de cada imóvel dos casos ainda sem arremate (23/09, dono): caso
    // aberto cujo imóvel foi VENDIDO a outro não é "contratada" — o cliente não arrematou e não
    // há mais o que arrematar (ex.: Rafael, CEF de 05/08 vendida, caso aberto em 07/08). Falha
    // nesta leitura devolve [] e o caso volta a contar como contratada: erra para o lado de
    // mostrar, nunca de esconder.
    const idsSemArremate = [...new Set(casos.filter((c) => !c.arrematado_em && !c.posse_em && c.imovel_id).map((c) => c.imovel_id))];
    const vendidos = new Set(idsSemArremate.length
      ? (await sbJson(`imoveis_leilao?id=in.(${idsSemArremate.join(',')})&resultado_leilao=eq.vendido&select=id`)).map((i) => String(i.id))
      : []);

    let nomeMembro = {};
    if (role === 'admin' && designacoes.length) {
      const membroIds = [...new Set(designacoes.map((d) => d.membro_id))];
      const membros = await sbJson(`perfis?id=in.(${membroIds.join(',')})&select=id,nome`);
      nomeMembro = Object.fromEntries(membros.map((m) => [m.id, m.nome]));
    }

    const clientes = perfis.map((p) => {
      const casosCliente = casos.filter((c) => c.cliente_id === p.id);
      // "Em andamento" = MESMA régua de podeContratarAssessoria (_assessoria.js): arrematou mas
      // ainda não deu posse — é o intervalo em que o cliente está de fato sendo assessorado
      // neste imóvel. Pedido do dono (22/09): sinalizar na lista, e destacar quando houver MAIS
      // DE UMA (mais de um imóvel assessorado ao mesmo tempo pede atenção redobrada da equipe).
      const emAndamento = casosCliente.filter((c) => c.arrematado_em && !c.posse_em).length;
      // 23/09 (dono): separar as TRÊS fases da arrematação assessorada. Não há tabela que ligue
      // contrato/honorário a um imóvel (os 4 assessorados de hoje nem têm contratos_link — o
      // contrato foi por fora), então a fase sai do próprio CASO, que é o registro por imóvel:
      //   contratada   = caso aberto ainda sem arremate (análise solicitada/pronta)
      //   em_andamento = arrematou, imissão de posse ainda não feita
      //   concluida    = posse registrada
      //   (fora das três) caso sem arremate cujo imóvel foi vendido a terceiro — não conta.
      //   (fora das três) caso sem arremate ENCERRADO pela equipe ("✓ Concluir caso" no Pipeline
      //   = status 'concluido'): o cliente não arrematou, ex. Rafael/ZUK de 31/08 (dono, 23/09).
      const perdida = (c) => !c.arrematado_em && !c.posse_em
        && (vendidos.has(String(c.imovel_id)) || c.status_etapa === 'concluido');
      const contratadas = casosCliente.filter((c) => !c.arrematado_em && !c.posse_em && !perdida(c)).length;
      const concluidas = casosCliente.filter((c) => c.posse_em).length;
      return {
        id: p.id, nome: p.nome, telefone: p.telefone,
        em_andamento: emAndamento, contratadas, concluidas,
        casos: casosCliente.map((c) => ({
          id: c.id, imovel_endereco: c.imovel_endereco, status_etapa: c.status_etapa,
          arrematado_em: c.arrematado_em, posse_em: c.posse_em, juridico_status: c.juridico_status,
          nao_arrematado: perdida(c),
        })),
        equipe_designada: role === 'admin'
          ? designacoes.filter((d) => d.cliente_id === p.id).map((d) => ({ membro_id: d.membro_id, nome: nomeMembro[d.membro_id] || d.membro_id }))
          : undefined,
      };
    });

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
