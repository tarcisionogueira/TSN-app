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
import { cpfDoRegistro } from './_cpf.js';
import { verificarSocioQSA } from './_pj-socio.js';

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

// Abre um chamado de supervisão/validação do saque (analista + dono veem no Atendimento).
async function abrirChamadoSaquePJ(user, perfil, valor, titulo) {
  try {
    await db('chamados', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      user_id: user.id, user_email: user.email || null, user_nome: perfil?.nome || null,
      titulo: `${titulo} (R$ ${Number(valor).toFixed(2)})`, segmento: 'saque_pj', status: 'aguardando_atendente',
    }) });
  } catch { /* o chamado é auxiliar — não bloqueia a solicitação de saque */ }
}

// Log de atividade do SAQUE (Cliente 360) — ação FINANCEIRA que antes era invisível na linha
// do tempo (só aparecia indireta em saldo_lancamentos). Best-effort: nunca afeta a solicitação.
async function logSaque(userId, evento, detalhe, meta = {}) {
  try { await rpc('registrar_atividade', { p_user_id: userId, p_evento: evento, p_detalhe: detalhe, p_meta: meta }); } catch { /* best-effort */ }
}

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
      // Embute dados de pagamento: PIX pessoal (equipe) OU PIX da empresa (parceiro-cliente B2B).
      const pendentes = (await db("saldo_lancamentos?status=eq.solicitado&order=criado_em.asc&select=*,perfis(nome,role,chave_pix,cnpj,razao_social,pj_chave_pix)")).data || [];
      // Marca quais solicitações já passaram do corte (elegíveis para a liberação de HOJE,
      // se hoje for sexta) — o admin vê o que pode pagar nesta sexta.
      const corte = corteHojeBahia();
      const hojeSexta = ehSexta();
      for (const p of pendentes) p.elegivel_hoje = hojeSexta && new Date(p.criado_em) <= corte;
      // Fila de saques de parceiro AGUARDANDO validação da PJ (analista/dono liberam ou reprovam
      // após conferir contrato social + quadro societário). Não é pagável enquanto não aprovado.
      const em_validacao_pj = (await db("saldo_lancamentos?status=eq.aguardando_pj&tipo=eq.saque&order=criado_em.asc&select=id,user_id,valor,descricao,criado_em,perfis(nome,role,cnpj,razao_social,pj_chave_pix,pj_validada_via,identidade_validada)")).data || [];
      return json({ saldos, pendentes, em_validacao_pj, hoje_sexta: hojeSexta, proxima_liberacao: proximaLiberacao().toISOString() });
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
    const perfil = (await db(`perfis?id=eq.${user.id}&select=nome,cpf,cpf_hash,telefone,chave_pix,cnpj,razao_social,pj_chave_pix,pj_validada_em,pj_revalidacao_pendente,pj_revalidacao_motivo`)).data?.[0] || {};
    const ehParceiroCliente = PLANOS_PAGOS.includes(role);
    const faltando = [];
    if (!perfil.nome || !String(perfil.nome).trim()) faltando.push('nome');
    // CPF: presente se houver texto claro (legado) OU o hash (cpf-set cifra e zera o texto).
    if (!(perfil.cpf && String(perfil.cpf).trim()) && !perfil.cpf_hash) faltando.push('CPF');
    if (!perfil.telefone || !String(perfil.telefone).trim()) faltando.push('telefone');
    // Parceiro-cliente recebe via PJ (B2B): exige empresa (CNPJ, razão social, PIX da empresa) —
    // espelha a RPC solicitar_saque_ledger. Equipe operacional recebe via PIX pessoal.
    if (ehParceiroCliente) {
      if (!perfil.cnpj || !String(perfil.cnpj).trim()) faltando.push('empresa (CNPJ)');
      if (!perfil.razao_social || !String(perfil.razao_social).trim()) faltando.push('razão social');
      if (!perfil.pj_chave_pix || !String(perfil.pj_chave_pix).trim()) faltando.push('PIX da empresa');
    } else {
      if (!perfil.chave_pix || !String(perfil.chave_pix).trim()) faltando.push('chave PIX');
    }
    // GATE PJ (anti-interposição): o parceiro-cliente só saca com a empresa VALIDADA pela equipe
    // (cartão CNPJ/contrato social + CPF no quadro societário + NF) — espelha o gate da RPC.
    // Enquanto pendente, o saldo acumula mas o saque fica bloqueado (crédito condicionado).
    const pjPendente = ehParceiroCliente && (!perfil.pj_validada_em || !!perfil.pj_revalidacao_pendente);
    // Flag INFORMATIVO (não bloqueia o saque): quem não está em plano pago não GANHA comissões
    // novas (a origem já filtra por "em dia na cobrança"); pode sacar o que já acumulou.
    const naoGanhaNovas = !podeReceber(role);
    // Data da próxima liberação (sexta 12:00 Bahia) para exibir na tela do profissional.
    return json({ saldo, extrato, proxima_liberacao: proximaLiberacao().toISOString(),
      nao_ganha_novas: naoGanhaNovas, pj_pendente: pjPendente,
      pj_revalidar: ehParceiroCliente && !!perfil.pj_revalidacao_pendente,
      pj_revalidacao_motivo: perfil.pj_revalidacao_motivo || null,
      saque_habilitado: faltando.length === 0 && !pjPendente, faltando });
  }

  // ── POST: solicitar saque ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const valor = Math.round(Number(body.valor) * 100) / 100;
    if (!valor || valor <= 0) return json({ error: 'Valor inválido' }, 400);

    const ehParceiroCliente = PLANOS_PAGOS.includes(role);

    // Equipe operacional (admin/analista/…): PIX pessoal, sem gate de PJ — fluxo original.
    // Checagem de saldo/PIX + inserção é ATÔMICA no banco (advisory lock por usuário).
    if (!ehParceiroCliente) {
      const r = await rpc('solicitar_saque_ledger', { p_user_id: user.id, p_valor: valor });
      if (!r.ok) return json({ error: 'Erro ao solicitar saque', detail: r.data }, 500);
      if (!r.data?.ok) return json({ error: r.data?.error || 'Não foi possível solicitar o saque' }, 400);
      await logSaque(user.id, 'saque', `Saque solicitado — R$ ${valor.toFixed(2)}`, { valor });
      return json({ ok: true, saldo_restante: r.data.saldo_restante }, 201);
    }

    // ── Parceiro-cliente: fluxo B2B com validação da PJ (anti-interposição) ──
    const perfil = (await db(`perfis?id=eq.${user.id}&select=nome,cpf,cpf_enc,cnpj,razao_social,pj_chave_pix,pj_validada_em,identidade_validada,pj_revalidacao_pendente,pj_revalidacao_motivo`)).data?.[0] || {};

    // KYC obrigatório (selfie + documento) antes de qualquer saque de parceiro.
    if (!perfil.identidade_validada) {
      return json({ error: 'Conclua a verificação de identidade (selfie + documento) antes de sacar.', kyc_pendente: true }, 422);
    }
    // Empresa (PJ) cadastrada.
    const faltaPJ = [];
    if (!perfil.cnpj || !String(perfil.cnpj).trim()) faltaPJ.push('empresa (CNPJ)');
    if (!perfil.razao_social || !String(perfil.razao_social).trim()) faltaPJ.push('razão social');
    if (!perfil.pj_chave_pix || !String(perfil.pj_chave_pix).trim()) faltaPJ.push('PIX da empresa');
    if (faltaPJ.length) return json({ error: `Cadastre a empresa para sacar. Falta: ${faltaPJ.join(', ')}.`, faltando: faltaPJ, pj_incompleta: true }, 422);

    // Empresa JÁ validada → tenta sacar direto. O gate de REVALIDAÇÃO vive na RPC: se a
    // reconferência periódica divergiu, ela devolve {pj_revalidar} e NÃO reserva nada — o
    // saldo a receber ACUMULA e não expira; o parceiro atualiza o CNPJ e revalida para liberar
    // (o retido paga junto com os ganhos futuros). Bloqueia o SAQUE, nunca o crédito.
    if (perfil.pj_validada_em) {
      const r = await rpc('solicitar_saque_ledger', { p_user_id: user.id, p_valor: valor });
      if (!r.ok) return json({ error: 'Erro ao solicitar saque', detail: r.data }, 500);
      if (!r.data?.ok) return json({ error: r.data.error || 'Não foi possível solicitar o saque', pj_revalidar: !!r.data.pj_revalidar, pj_pendente: !!r.data.pj_pendente, faltando: r.data.faltando }, 422);
      await logSaque(user.id, 'saque', `Saque solicitado — R$ ${valor.toFixed(2)}`, { valor });
      return json({ ok: true, saldo_restante: r.data.saldo_restante }, 201);
    }

    // 1ª validação do cadastro: tenta a AUTOMAÇÃO (CPF do parceiro no quadro societário/QSA da
    // Receita, grátis). Match → valida e libera; sem match → conferência manual (analista/dono).
    let autoOk = false;
    try {
      const cpf = await cpfDoRegistro(perfil);
      const v = await verificarSocioQSA({ cnpj: perfil.cnpj, cpf, nome: perfil.nome });
      if (v.matched) { await rpc('registrar_pj_validacao_auto', { p_user_id: user.id, p_snapshot: v.snapshot }); autoOk = true; }
    } catch { autoOk = false; } // fail-closed → conferência manual

    if (autoOk) {
      const r = await rpc('solicitar_saque_ledger', { p_user_id: user.id, p_valor: valor });
      if (!r.ok || !r.data?.ok) return json({ error: r.data?.error || 'Não foi possível solicitar o saque', detail: r.data }, 400);
      await abrirChamadoSaquePJ(user, perfil, valor, 'Saque de parceiro liberado pela automação (CPF confere no quadro societário) — supervisão');
      await logSaque(user.id, 'saque', `Saque de parceiro solicitado — R$ ${valor.toFixed(2)} (validação automática QSA)`, { valor, via: 'auto_qsa' });
      return json({ ok: true, saldo_restante: r.data.saldo_restante, via: 'auto_qsa' }, 201);
    }

    // Validação MANUAL: reserva como 'aguardando_pj' (não pagável) e abre chamado p/ analista + dono.
    const r = await rpc('solicitar_saque_pj_pendente', { p_user_id: user.id, p_valor: valor });
    if (!r.ok) return json({ error: 'Erro ao solicitar saque', detail: r.data }, 500);
    if (!r.data?.ok) return json({ error: r.data?.error || 'Não foi possível solicitar o saque', faltando: r.data?.faltando, kyc_pendente: r.data?.kyc_pendente }, 400);
    await abrirChamadoSaquePJ(user, perfil, valor, 'Saque de parceiro — CPF não confirmado no quadro societário; conferir contrato social e liberar/reprovar');
    await logSaque(user.id, 'saque', `Saque de parceiro solicitado — R$ ${valor.toFixed(2)} (em validação manual da PJ)`, { valor, em_validacao: true });
    return json({ ok: true, em_validacao: true, saldo_restante: r.data.saldo_restante }, 201);
  }

  // ── PATCH: validação da PJ (analista/dono) + pagamento (admin, só sexta) ──
  if (req.method === 'PATCH') {
    let body; try { body = await req.json(); } catch { body = {}; }
    const acao = body.acao;

    // Validação MANUAL do saque de parceiro (2º+ ou 1º sem match automático).
    // Analista (funcionário) OU dono (admin, supervisiona e pode assumir) liberam ou reprovam.
    if (acao === 'aprovar_pj' || acao === 'reprovar_pj') {
      if (role !== 'admin' && role !== 'analista') return forbidden();
      const idv = url.searchParams.get('id');
      if (!idv || !/^\d+$/.test(idv)) return json({ error: 'id inválido' }, 400);
      if (acao === 'aprovar_pj') {
        const r = await rpc('aprovar_saque_pj', { p_lanc_id: Number(idv), p_validador: user.id, p_via: 'manual' });
        if (!r.ok || !r.data?.ok) return json({ error: r.data?.error || 'Erro ao aprovar' }, 400);
        return json({ ok: true });
      }
      const r = await rpc('reprovar_saque_pj', { p_lanc_id: Number(idv), p_motivo: String(body.motivo || '') });
      if (!r.ok || !r.data?.ok) return json({ error: r.data?.error || 'Erro ao reprovar' }, 400);
      return json({ ok: true });
    }

    // Pagamento do saque é só do admin.
    if (role !== 'admin') return forbidden();

    // Liberar TODOS os elegíveis de uma vez (sexta + até o corte de 12h).
    if (acao === 'pagar_todos') {
      if (!ehSexta()) return json({ error: 'Pagamentos de saque são processados apenas às sextas-feiras.' }, 422);
      const corteISO = corteHojeBahia().toISOString();
      const patch = { status: 'sacado', pago_em: new Date().toISOString(), pago_por: user.id };
      if (body.descricao) patch.comprovante_desc = String(body.descricao).slice(0, 500);
      const r = await db(`saldo_lancamentos?status=eq.solicitado&criado_em=lte.${encodeURIComponent(corteISO)}`, {
        method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=representation' },
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
      const patch = { status: 'sacado', pago_em: new Date().toISOString(), pago_por: user.id };
      if (body.comprovante_url) patch.comprovante_url = String(body.comprovante_url).slice(0, 2000);
      if (body.descricao) patch.comprovante_desc = String(body.descricao).slice(0, 500);
      const r = await db(`saldo_lancamentos?id=eq.${id}&status=eq.solicitado`, {
        method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' },
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
