/**
 * /api/minhas-oportunidades  (cliente logado)
 *  GET                                     as oportunidades que a equipe selecionou para ele
 *  GET ?cliente_id=<uuid>                  a mesma lista, só leitura, para a equipe em modo suporte
 *  POST { acao:'visto', ids:[...] }        carimba a primeira vez que o cartão apareceu ao próprio cliente
 *  POST { acao:'decidir', id, decisao, versao, motivo_recusa? }  aprova para a reunião ou recusa
 *
 * A decisão só vale para `cliente_id = usuário do JWT`. A equipe em modo suporte usa o próprio token e cai no 404:
 * quem barra é o servidor, não o botão escondido. Aprovar pede a reunião e não autoriza lance (termo, 1.3 e 1.5).
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { logAtividade } from './_atividade.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { sb, lerLista, emailAEquipeOportunidade } from './_atendimento-canal.js';
import { VERSAO_TEXTOS, AVISO_NAO_E_LANCE, TEXTOS_DECISAO, SEL_LOTE, sha256, estadoDaOportunidade, visaoDaOportunidade } from './_oportunidade-selecionada.js';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES_EQUIPE = ['analista', 'advogado', 'consultor'];

async function lotesVivos(linhas) {
  const ids = [...new Set(linhas.map((l) => l.imovel_id))];
  if (!ids.length) return new Map();
  const lotes = await lerLista(`imoveis_leilao?id=in.(${ids.join(',')})&select=${SEL_LOTE},ativo`);
  return new Map(lotes.map((l) => [l.id, l]));
}

async function reunioes(linhas) {
  const ids = linhas.map((l) => l.solicitacao_id).filter(Boolean);
  if (!ids.length) return new Map();
  const sol = await lerLista(`solicitacoes?id=in.(${ids.join(',')})&select=id,reuniao_em,google_meet_link`);
  return new Map(sol.map((s) => [s.id, s]));
}

export async function GET(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  try {
    const pedido = new URL(req.url, 'http://localhost').searchParams.get('cliente_id');
    let clienteId = user.id;
    let somenteLeitura = false;
    if (pedido && pedido !== user.id) {
      if (!RE_UUID.test(pedido)) return json({ error: 'cliente_id inválido' }, 400);
      const role = await getUserRoleById(user.id);
      if (role !== 'admin' && !ROLES_EQUIPE.includes(role)) return forbidden('Sem permissão');
      if (role !== 'admin') {
        const d = await lerLista(`assessorado_designacao?cliente_id=eq.${pedido}&membro_id=eq.${user.id}&select=cliente_id&limit=1`);
        if (!d.length) return forbidden('Este cliente não está designado a você');
      }
      clienteId = pedido;
      somenteLeitura = true;
    }
    const linhas = await lerLista(`oportunidades_selecionadas?cliente_id=eq.${clienteId}&select=*&order=selecionada_em.desc&limit=50`);
    const [vivos, sol] = await Promise.all([lotesVivos(linhas), reunioes(linhas)]);
    return json({
      somente_leitura: somenteLeitura,
      aviso_decisao: AVISO_NAO_E_LANCE,
      textos: { versao: VERSAO_TEXTOS, ...TEXTOS_DECISAO },
      oportunidades: linhas.map((l) => ({
        ...visaoDaOportunidade(l, vivos.get(l.imovel_id)),
        reuniao_em: sol.get(l.solicitacao_id)?.reuniao_em || null,
        reuniao_link: sol.get(l.solicitacao_id)?.google_meet_link || null,
      })),
    });
  } catch (e) {
    console.error('[minhas-oportunidades] GET', e.message);
    return json({ error: 'Não consegui carregar suas oportunidades agora.' }, 502);
  }
}

export async function POST(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const rl = await checkRateLimit(`minhas-oportunidades:${user.id}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'corpo inválido' }, 400); }

  try {
    if (b.acao === 'visto') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter((i) => RE_UUID.test(String(i))).slice(0, 20);
      if (!ids.length) return json({ ok: true, marcadas: 0 });
      const r = await sb(`oportunidades_selecionadas?id=in.(${ids.join(',')})&cliente_id=eq.${user.id}&visto_em=is.null&select=id`, {
        method: 'PATCH', prefer: 'return=representation', body: { visto_em: new Date().toISOString() } });
      if (!r.ok) throw new Error(`visto HTTP ${r.status}`);
      return json({ ok: true, marcadas: (await r.json()).length });
    }

    if (b.acao !== 'decidir') return json({ error: 'Ação inválida.' }, 400);
    if (!RE_UUID.test(String(b.id || ''))) return json({ error: 'id inválido' }, 400);
    if (!['aprovada', 'recusada'].includes(b.decisao)) return json({ error: 'Decisão inválida.' }, 400);
    if (b.versao !== VERSAO_TEXTOS) return json({ error: 'O texto desta decisão mudou. Atualize a página e leia de novo antes de responder.' }, 409);

    const [linha] = await lerLista(`oportunidades_selecionadas?id=eq.${b.id}&cliente_id=eq.${user.id}&select=*&limit=1`);
    if (!linha) return json({ error: 'Oportunidade não encontrada.' }, 404);
    const [loteVivo] = await lerLista(`imoveis_leilao?id=eq.${linha.imovel_id}&select=${SEL_LOTE},ativo&limit=1`);
    const estado = estadoDaOportunidade(linha, loteVivo);
    if (estado === 'expirada') return json({ error: 'As datas deste leilão já passaram, então não há mais o que decidir.' }, 409);
    if (estado === 'equipe_confere' && b.decisao === 'aprovada') return json({ error: 'Este lote saiu da nossa lista e a equipe está conferindo. Avisaremos você.' }, 409);

    const texto = TEXTOS_DECISAO[b.decisao];
    // O filtro por status torna a decisão atômica: dois cliques, ou duas abas, gravam uma vez só.
    const r = await sb(`oportunidades_selecionadas?id=eq.${linha.id}&cliente_id=eq.${user.id}&status=eq.selecionada&select=*`, {
      method: 'PATCH', prefer: 'return=representation', body: {
        status: b.decisao, decidida_em: new Date().toISOString(), decisao_texto: texto, decisao_texto_versao: VERSAO_TEXTOS, decisao_texto_sha256: sha256(texto),
        decisao_ip: String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || null,
        decisao_user_agent: String(req.headers.get('user-agent') || '').slice(0, 300) || null,
        motivo_recusa: b.decisao === 'recusada' ? (String(b.motivo_recusa || '').trim().slice(0, 500) || null) : null,
      } });
    if (!r.ok) throw new Error(`decisão HTTP ${r.status}`);
    const [gravada] = await r.json();
    if (!gravada) return json({ error: 'Esta oportunidade já foi respondida.' }, 409);

    const lote = linha.retrato?.lote || {};
    const titulo = lote.titulo || lote.tipo || linha.imovel_id;
    const avisos = [];
    // A decisão já vale. Falha daqui em diante não a desfaz: fica no log, no e-mail à equipe e em oportunidades_paradas().
    try {
      if (b.decisao === 'aprovada') {
        const rs = await sb('solicitacoes', { method: 'POST', prefer: 'return=representation', body: {
          user_id: user.id, imovel_ref: linha.imovel_id, imovel_nome: String(titulo).slice(0, 300), imovel_cidade: lote.cidade || '',
          tipo: 'consulta', status: 'solicitado', analista_id: linha.selecionada_por,
          notas_analista: 'Reunião de apresentação: o cliente aprovou a oportunidade selecionada pela equipe. A aprovação não autoriza lance.',
        } });
        const [sol] = rs.ok ? await rs.json() : [];
        if (sol?.id) {
          const rv = await sb(`oportunidades_selecionadas?id=eq.${linha.id}&select=id`, { method: 'PATCH', prefer: 'return=representation', body: { solicitacao_id: sol.id } });
          if (!rv.ok || !(await rv.json()).length) { console.error('[minhas-oportunidades] solicitação não vinculada', linha.id, rv.status); avisos.push('solicitação criada e não vinculada'); }
        } else {
          console.error('[minhas-oportunidades] reunião não entrou na fila', linha.id, rs.status);
          avisos.push('a reunião não entrou na fila');
        }
      }
      await logAtividade(user.id, b.decisao === 'aprovada' ? 'oportunidade_aprovada' : 'oportunidade_recusada',
        `Cliente ${b.decisao === 'aprovada' ? 'aprovou para reunião' : 'recusou'}: ${String(titulo).slice(0, 140)}`, { oportunidade_id: linha.id, imovel_id: linha.imovel_id }, user.id);
      const ra = await emailAEquipeOportunidade({ decisao: b.decisao, titulo, clienteEmail: user.email, motivo: gravada.motivo_recusa, avisos });
      if (!ra.ok) console.error('[minhas-oportunidades] aviso à equipe não saiu', linha.id, ra.error);
    } catch (e) {
      console.error('[minhas-oportunidades] depois da decisão', linha.id, e.message);
    }

    return json({
      ok: true, status: b.decisao,
      recibo: b.decisao === 'aprovada'
        ? 'Registramos sua aprovação para a reunião. A equipe vai propor a data. Nenhum lance foi autorizado.'
        : 'Registramos sua recusa. Nenhum lance será dado neste imóvel. A equipe segue buscando outras opções.',
    });
  } catch (e) {
    console.error('[minhas-oportunidades] POST', e.message);
    return json({ error: 'Não consegui registrar agora. Atualize a página para conferir sua resposta e tente de novo.' }, 502);
  }
}
