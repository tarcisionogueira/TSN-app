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

// DIREITO DE RECEBER (regra do dono): qualquer cliente pode ser PARCEIRO e indicar, mas só tem
// direito a RECEBER (sacar) as comissões quem é PAGANTE (plano pago) — ou quem é EQUIPE/
// profissional (admin/analista/advogado/consultor/afiliado/leiloeiro, que recebem por função).
// Um Explorador (grátis) indica normalmente; para sacar, precisa de uma assinatura ativa.
const PLANOS_PAGOS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const ROLES_EQUIPE = ['admin', 'analista', 'advogado', 'consultor', 'afiliado', 'leiloeiro'];
const podeReceber = (role) => PLANOS_PAGOS.includes(role) || ROLES_EQUIPE.includes(role);

// ── Janela de saque (fuso America/Bahia, UTC−3 sem horário de verão) ──────────
// Regra: solicitações são avulsas e ilimitadas durante a semana; o PAGAMENTO sai
// só às sextas, com CORTE ao meio-dia — o que entra até sexta 12h cai naquela
// sexta; depois disso, na sexta seguinte.
function partesBahia(d) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bahia', weekday: 'short' }).format(d);
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  return { ymd, idx };
}
function ehSexta(now = new Date()) { return partesBahia(now).idx === 5; }
// Meio-dia de HOJE em Bahia como instante UTC (corte da liberação de sexta).
function corteHojeBahia(now = new Date()) { return new Date(`${partesBahia(now).ymd}T12:00:00-03:00`); }
// Próxima liberação: sexta 12:00 (Bahia) igual/após `now`. Se já passou o corte
// de sexta, aponta para a sexta seguinte.
function proximaLiberacao(now = new Date()) {
  const { ymd, idx } = partesBahia(now);
  const sexta = new Date(`${ymd}T12:00:00-03:00`);
  sexta.setUTCDate(sexta.getUTCDate() + ((5 - idx + 7) % 7)); // sexta desta semana (sem DST: mantém 12:00)
  if (now.getTime() > sexta.getTime()) sexta.setUTCDate(sexta.getUTCDate() + 7);
  return sexta;
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
      // Embute o solicitante (nome/papel/PIX) para a conferência do admin.
      const pendentes = (await db("saldo_lancamentos?status=eq.solicitado&order=criado_em.asc&select=*,perfis(nome,role,chave_pix)")).data || [];
      // Marca quais solicitações já passaram do corte (elegíveis para a liberação de HOJE,
      // se hoje for sexta) — o admin vê o que pode pagar nesta sexta.
      const corte = corteHojeBahia();
      const hojeSexta = ehSexta();
      for (const p of pendentes) p.elegivel_hoje = hojeSexta && new Date(p.criado_em) <= corte;
      return json({ saldos, pendentes, hoje_sexta: hojeSexta, proxima_liberacao: proximaLiberacao().toISOString() });
    }

    // Analítico de UM beneficiário: cada crédito (honorário/comissão) com o valor da
    // VENDA que o originou e o REPASSE, para a conferência antes de liberar o saque.
    if (url.searchParams.get('analitico') === '1') {
      if (role !== 'admin') return forbidden();
      const uid = url.searchParams.get('user_id') || '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) return json({ error: 'user_id inválido' }, 400);
      const creditos = (await db(`saldo_lancamentos?user_id=eq.${uid}&tipo=in.(honorario_exito,comissao_venda)&order=criado_em.desc&select=tipo,valor,origem_tipo,origem_id,descricao,criado_em,status`)).data || [];
      const arremIds = [...new Set(creditos.filter(c => c.tipo === 'honorario_exito' && c.origem_id).map(c => c.origem_id))];
      const comIds  = [...new Set(creditos.filter(c => c.tipo === 'comissao_venda' && c.origem_id).map(c => c.origem_id))];
      const arremMap = {}, comMap = {};
      if (arremIds.length) {
        const rows = (await db(`arrematacoes?id=in.(${arremIds.join(',')})&select=id,valor_arrematado`)).data || [];
        for (const r of rows) arremMap[r.id] = Number(r.valor_arrematado || 0);
      }
      if (comIds.length) {
        const rows = (await db(`comissoes?gateway_payment_id=in.(${comIds.map(encodeURIComponent).join(',')})&select=gateway_payment_id,valor_base,percentual,referencia`)).data || [];
        for (const r of rows) comMap[r.gateway_payment_id] = r;
      }
      const linhas = creditos.map(c => ({
        data: c.criado_em, tipo: c.tipo, descricao: c.descricao, status: c.status,
        repasse: Number(c.valor || 0),
        venda: c.tipo === 'honorario_exito' ? (arremMap[c.origem_id] ?? null) : (comMap[c.origem_id]?.valor_base ?? null),
        percentual: c.tipo === 'comissao_venda' ? (comMap[c.origem_id]?.percentual ?? null) : null,
        referencia: c.tipo === 'comissao_venda' ? (comMap[c.origem_id]?.referencia ?? null) : null,
      }));
      const totalRepasse = linhas.reduce((s, l) => s + (l.repasse > 0 ? l.repasse : 0), 0);
      return json({ user_id: uid, linhas, total_repasse: totalRepasse });
    }
    const saldo = await saldoDe(user.id);
    const extrato = (await db(`saldo_lancamentos?user_id=eq.${user.id}&order=criado_em.desc&limit=200&select=*`)).data || [];
    // Pré-requisitos do saque: cadastro completo (nome, CPF, telefone, chave PIX).
    // Aponta o que falta para o profissional liberar o saque (espelha a RPC).
    const perfil = (await db(`perfis?id=eq.${user.id}&select=nome,cpf,cpf_hash,telefone,chave_pix`)).data?.[0] || {};
    const faltando = [];
    if (!perfil.nome || !String(perfil.nome).trim()) faltando.push('nome');
    // CPF: presente se houver texto claro (legado) OU o hash (cpf-set cifra e zera o texto).
    if (!(perfil.cpf && String(perfil.cpf).trim()) && !perfil.cpf_hash) faltando.push('CPF');
    if (!perfil.telefone || !String(perfil.telefone).trim()) faltando.push('telefone');
    if (!perfil.chave_pix || !String(perfil.chave_pix).trim()) faltando.push('chave PIX');
    // Explorador/grátis pode indicar, mas só recebe (saca) sendo pagante. Sinaliza p/ a UI.
    const precisaAssinatura = !podeReceber(role);
    // Data da próxima liberação (sexta 12:00 Bahia) para exibir na tela do profissional.
    return json({ saldo, extrato, proxima_liberacao: proximaLiberacao().toISOString(),
      precisa_assinatura: precisaAssinatura,
      saque_habilitado: faltando.length === 0 && !precisaAssinatura, faltando });
  }

  // ── POST: solicitar saque ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const valor = Math.round(Number(body.valor) * 100) / 100;
    if (!valor || valor <= 0) return json({ error: 'Valor inválido' }, 400);
    // Trava de negócio (regra do dono): só saca quem tem DIREITO A RECEBER (pagante ou equipe).
    // Explorador/grátis pode indicar e acumular, mas precisa assinar para liberar o saque.
    if (!podeReceber(role)) return json({ error: 'Para RECEBER suas comissões é preciso ter uma assinatura ativa (plano pago). Você pode indicar normalmente — assine para liberar o saque.' }, 403);

    // Checagem de saldo/PIX + inserção do lançamento é ATÔMICA no banco
    // (serializada por usuário) — elimina a corrida read-then-write que
    // permitia dois saques simultâneos zerarem o mesmo saldo.
    const r = await rpc('solicitar_saque_ledger', { p_user_id: user.id, p_valor: valor });
    if (!r.ok) return json({ error: 'Erro ao solicitar saque', detail: r.data }, 500);
    if (!r.data?.ok) return json({ error: r.data?.error || 'Não foi possível solicitar o saque' }, 400);
    return json({ ok: true, saldo_restante: r.data.saldo_restante }, 201);
  }

  // ── PATCH: admin paga (só sexta) — em massa ou individual — ou recusa ─────
  if (req.method === 'PATCH') {
    if (role !== 'admin') return forbidden();
    let body; try { body = await req.json(); } catch { body = {}; }
    const acao = body.acao;

    // Liberar TODOS os elegíveis de uma vez (sexta + até o corte de 12h).
    if (acao === 'pagar_todos') {
      if (!ehSexta()) return json({ error: 'Pagamentos de saque são processados apenas às sextas-feiras.' }, 422);
      const corteISO = corteHojeBahia().toISOString();
      const r = await db(`saldo_lancamentos?status=eq.solicitado&criado_em=lte.${encodeURIComponent(corteISO)}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'sacado' }), headers: { Prefer: 'return=representation' },
      });
      if (!r.ok) return json({ error: 'Erro ao liberar pagamentos', detail: r.data }, 500);
      const pagos = Array.isArray(r.data) ? r.data.length : 0;
      return json({ ok: true, pagos });
    }

    // Ações individuais precisam do id do lançamento (bigint).
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id obrigatório' }, 400);
    if (!/^\d+$/.test(id)) return json({ error: 'id inválido' }, 400);

    if (acao === 'pagar') {
      if (!ehSexta()) return json({ error: 'Pagamentos de saque são processados apenas às sextas-feiras.' }, 422);
      // Corte de sexta ao meio-dia: só paga hoje o que foi solicitado até 12h de HOJE.
      // Solicitação feita depois do corte entra na liberação da próxima sexta.
      const alvo = (await db(`saldo_lancamentos?id=eq.${id}&status=eq.solicitado&select=id,criado_em`)).data?.[0];
      if (!alvo) return json({ error: 'Solicitação não encontrada ou já processada.' }, 404);
      if (new Date(alvo.criado_em) > corteHojeBahia()) {
        return json({ error: 'Solicitação feita após o corte de sexta (12h). Entra na liberação da próxima sexta.' }, 422);
      }
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
