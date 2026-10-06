// UMA RECORRÊNCIA ATIVA POR CLIENTE, decidida DEPOIS do pagamento novo (04/10, pendência 123).
//
// Antes, o checkout (src/pages/Checkout.jsx) cancelava as assinaturas ativas nos DOIS gateways
// ANTES de criar a nova: upgrade ou troca de ciclo abandonado (ou com MP e Asaas falhando) deixava
// o cliente pagante SEM recorrência — e o webhook do cancelamento ainda mandava o e-mail de
// "resgate". O backstop B1 do mp-webhook só cancelava mandatos do próprio MP.
//
// Aqui: quando a NOVA recorrência é confirmada (MP: mandato `authorized`; Asaas: 1º pagamento
// confirmado de uma subscription), cancela as OUTRAS, nos dois gateways, mantendo a nova.
//
// TRÊS TRAVAS (revisão ofensiva de 04/10 — a 1ª versão errava nos três pontos):
//  1. UMA VEZ por recorrência mantida (marca em webhook_eventos_processados). Sem isto, a renovação
//     mensal da ANTIGA, ou o PAYMENT_RECEIVED atrasado da 1ª fatura dela, rodava a limpeza "mantendo
//     a antiga" e apagava a NOVA.
//  2. Se existe recorrência ativa criada DEPOIS da mantida, não cancela nada e alerta — a mantida
//     não é a mais recente, então "manter esta" seria apagar a que o cliente escolheu por último.
//     (Comparação por DIA: o Asaas só informa a data de criação, sem hora.)
//  3. Sem o e-mail da conta não dá para achar os mandatos do MP — busca pelo userId; faltando
//     mesmo assim, ALERTA (antes pulava calado e a troca MP→Asaas seguia cobrando em dobro).
// Nunca lança: a ativação do plano não pode cair por causa da limpeza — toda falha ALERTA.
import { alertarErro } from './_error-alert.js';

const MP_BASE = 'https://api.mercadopago.com';
const asaasBase = () => (process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
const asaasKey = () => (process.env.ASAAS_API_KEY || '').trim();
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sbHdr = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' });
const dia = (v) => String(v || '').slice(0, 10); // 'YYYY-MM-DD' (MP traz ISO completo; Asaas só a data)

async function asaasIdDoPerfil(userId) {
  if (!userId || !SB_URL || !SB_KEY) return null;
  const r = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(userId)}&select=asaas_id&limit=1`, { headers: sbHdr() });
  if (!r.ok) throw new Error(`perfis.asaas_id ${r.status}`);
  const [p] = await r.json();
  return p?.asaas_id || null;
}

// E-mail da CONTA (auth.users) — é o mesmo usado como payer_email ao criar o mandato (api/mp.js).
async function emailDaConta(userId) {
  if (!userId || !SB_URL || !SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: sbHdr() });
  if (!r.ok) throw new Error(`auth admin ${r.status}`);
  const u = await r.json();
  return u?.email || u?.user?.email || null;
}

// Marca atômica "limpeza já feita para esta recorrência". true = primeira vez (pode seguir).
async function marcarPrimeiraVez(chave) {
  const r = await fetch(`${SB_URL}/rest/v1/webhook_eventos_processados`, {
    method: 'POST', headers: { ...sbHdr(), Prefer: 'return=minimal' },
    body: JSON.stringify({ gateway: 'recorrencia', gateway_payment_id: chave, evento: 'recorrencia_unica' }),
  });
  if (r.ok) return true;
  if (r.status === 409) return false; // já feita
  throw new Error(`marca recorrencia_unica ${r.status}: ${(await r.text().catch(() => '')).slice(0, 120)}`);
}

async function asaasGet(path) {
  const r = await fetch(`${asaasBase()}${path}`, { headers: { access_token: asaasKey() } });
  if (!r.ok) throw new Error(`asaas ${path.split('?')[0]} ${r.status}`);
  return r.json();
}

// Assinaturas ACTIVE do cliente no Asaas, com data de criação. TRI-ESTADO como o
// `checarAsaasAtivo` da reconciliação: erro de consulta NÃO é "sem assinatura".
export async function assinaturasAsaasAtivas({ asaasCustomerId, userId }) {
  if (!asaasKey()) return { subs: [], erro: null };
  try {
    const cust = asaasCustomerId || await asaasIdDoPerfil(userId);
    if (!cust) return { subs: [], erro: null };
    const d = await asaasGet(`/subscriptions?customer=${encodeURIComponent(cust)}&status=ACTIVE&limit=20`);
    return { subs: (d?.data || []).filter((s) => s?.id).map((s) => ({ id: String(s.id), criadaEm: dia(s.dateCreated) })), erro: null };
  } catch (e) { return { subs: [], erro: e?.message || String(e) }; }
}

// Subscription do Asaas que NUNCA teve pagamento confirmado/recebido. null = não sei (erro).
export async function assinaturaAsaasNuncaPaga(subId) {
  if (!subId || !asaasKey()) return null;
  try {
    for (const st of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
      const d = await asaasGet(`/payments?subscription=${encodeURIComponent(subId)}&status=${st}&limit=1`);
      if ((d?.data || []).length) return false;
    }
    return true;
  } catch (e) { console.error('[recorrencia-unica] consulta de pagamentos da subscription falhou:', subId, e?.message || e); return null; }
}

export async function apagarAssinaturaAsaas(subId) {
  const r = await fetch(`${asaasBase()}/subscriptions/${encodeURIComponent(subId)}`, { method: 'DELETE', headers: { access_token: asaasKey() } });
  if (!r.ok) throw new Error(`asaas DELETE subscription ${r.status}`);
}

// O cliente tem OUTRA recorrência ativa além de `excetoAsaasSubId`? (MP authorized do userId ou
// subscription ACTIVE do Asaas). Tri-estado: { tem, erro }. Usado no vencimento de subscription
// nunca paga: só é "troca abandonada" quando existe outra recorrência que o cliente segue pagando.
export async function temOutraRecorrenciaAtiva({ userId, asaasCustomerId, excetoAsaasSubId }) {
  try {
    const { subs, erro } = await assinaturasAsaasAtivas({ asaasCustomerId, userId });
    if (erro) return { tem: false, erro };
    if (subs.some((x) => x.id !== String(excetoAsaasSubId || ''))) return { tem: true, erro: null };
    const mpToken = process.env.MP_ACCESS_TOKEN;
    if (!mpToken || !userId) return { tem: false, erro: null };
    const email = await emailDaConta(userId);
    if (!email) return { tem: false, erro: 'sem e-mail da conta' };
    const r = await fetch(`${MP_BASE}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=20`, { headers: { Authorization: `Bearer ${mpToken}` } });
    if (!r.ok) return { tem: false, erro: `MP busca ${r.status}` };
    const d = await r.json();
    return { tem: (d?.results || []).some((x) => String(x.external_reference || '').split('|')[0] === String(userId)), erro: null };
  } catch (e) { return { tem: false, erro: e?.message || String(e) }; }
}

export async function cancelarOutrasRecorrencias({ userId, email, asaasCustomerId, manterMpId = null, manterAsaasSubId = null, manterCriadaEm = null, origem }) {
  const out = { mpCancelados: [], asaasCancelados: [], erros: [], pulado: null };
  const alertar = () => {
    if (!out.erros.length) return;
    console.error(`[recorrencia-unica] ${origem}: falhas`, out.erros);
    alertarErro({ rota: `recorrencia-unica/${origem}`, erro: `Recorrência antiga NÃO cancelada — RISCO DE COBRANÇA DUPLA para o usuário ${userId}. Conferir nos painéis do MP/Asaas: ${out.erros.join(' | ')}`, extra: { userId, manterMpId, manterAsaasSubId } });
  };
  if (!userId) { out.erros.push('sem userId'); alertar(); return out; }
  const chave = manterMpId ? `mp:${manterMpId}` : `asaas:${manterAsaasSubId}`;
  const mpToken = process.env.MP_ACCESS_TOKEN;

  try {
    // Recorrência mantida do Asaas: tem que estar ACTIVE (se já foi apagada, não há o que manter).
    let refDia = dia(manterCriadaEm);
    if (manterAsaasSubId) {
      const s = await asaasGet(`/subscriptions/${encodeURIComponent(manterAsaasSubId)}`);
      if (s?.status !== 'ACTIVE' || s?.deleted) { out.pulado = 'mantida_nao_ativa'; return out; }
      refDia = dia(s.dateCreated) || refDia;
    }

    // Coleta as OUTRAS recorrências ativas dos dois gateways.
    if (!email) { try { email = await emailDaConta(userId); } catch (e) { out.erros.push(`e-mail da conta: ${e?.message || e}`); } }
    const mpOutros = [];
    if (!mpToken) { /* MP não configurado neste ambiente — nada a conferir */ } else if (!email) out.erros.push('sem e-mail da conta — mandatos do MP não conferidos');
    else {
      const r = await fetch(`${MP_BASE}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=20`, { headers: { Authorization: `Bearer ${mpToken}` } });
      if (!r.ok) throw new Error(`MP busca ${r.status}`);
      const d = await r.json();
      for (const p of d?.results || []) {
        if (String(p.id) === String(manterMpId || '')) continue;
        if (String(p.external_reference || '').split('|')[0] !== String(userId)) continue;
        mpOutros.push({ id: String(p.id), criadaEm: dia(p.date_created) });
      }
    }
    const { subs, erro } = await assinaturasAsaasAtivas({ asaasCustomerId, userId });
    if (erro) throw new Error(`Asaas (consulta): ${erro}`);
    const asaasOutros = subs.filter((s) => s.id !== String(manterAsaasSubId || ''));

    // Trava 2: existe alguma MAIS NOVA que a mantida? Então esta não é a escolha final do cliente.
    const maisNova = [...mpOutros, ...asaasOutros].find((o) => refDia && o.criadaEm && o.criadaEm > refDia);
    if (maisNova) {
      out.pulado = 'existe_recorrencia_mais_nova';
      out.erros.push(`a recorrência mantida (${chave}, ${refDia}) é mais ANTIGA que ${maisNova.id} (${maisNova.criadaEm}) — nada cancelado, decidir à mão`);
      alertar();
      return out;
    }
    if (!mpOutros.length && !asaasOutros.length) return out; // nada a limpar — não gasta a marca

    // Trava 1: uma vez por recorrência mantida.
    if (!(await marcarPrimeiraVez(chave))) { out.pulado = 'ja_feito'; return out; }

    for (const p of mpOutros) {
      const c = await fetch(`${MP_BASE}/preapproval/${p.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      if (c.ok) out.mpCancelados.push(p.id); else out.erros.push(`MP ${p.id}: ${c.status}`);
    }
    for (const s of asaasOutros) {
      try { await apagarAssinaturaAsaas(s.id); out.asaasCancelados.push(s.id); }
      catch (e) { out.erros.push(`Asaas ${s.id}: ${e?.message || e}`); } // padrao-ok: motivo vai para out.erros, logado e alertado no fim
    }
    // Falhou algum cancelamento: libera a marca para o próximo evento desta recorrência tentar de
    // novo (eventos atrasados da ANTIGA continuam barrados pelas travas de ativa/mais nova).
    if (out.erros.length) {
      const rm = await fetch(`${SB_URL}/rest/v1/webhook_eventos_processados?gateway=eq.recorrencia&gateway_payment_id=eq.${encodeURIComponent(chave)}&evento=eq.recorrencia_unica`, { method: 'DELETE', headers: sbHdr() });
      if (!rm.ok) out.erros.push(`marca não liberada (${rm.status}) — retentativa manual`);
    }
  } catch (e) {
    out.erros.push(e?.message || String(e));
  }

  if (out.mpCancelados.length || out.asaasCancelados.length) {
    console.log(`[recorrencia-unica] ${origem}: user=${userId} mantida=${chave} mp=${out.mpCancelados.join(',') || '-'} asaas=${out.asaasCancelados.join(',') || '-'}`);
  }
  alertar();
  return out;
}

// ASSESSORIA INCLUI O PRO (06/10, regra_negocio['assessoria.inclui_pro']): contratada a assessoria,
// a mensalidade do Investidor Pro para de ser cobrada — enquanto ela estiver ativa os benefícios
// vêm do papel `assessorado`. Cancela SÓ a recorrência do Pro (MP: external_reference `uid|top2*`;
// Asaas: descrição "Investidor Pro…", sem maxPayments). O parcelamento 12× da PRÓPRIA assessoria
// também é recorrência e não pode ser tocado — por isso o filtro é pelo plano, não "todas as outras".
// Nunca lança: a ativação da assessoria não pode cair por causa disto — toda falha ALERTA.
export async function cancelarRecorrenciaPro({ userId, email, asaasCustomerId, origem }) {
  const out = { mpCancelados: [], asaasCancelados: [], erros: [] };
  if (!userId) return out;
  const mpToken = process.env.MP_ACCESS_TOKEN;
  try {
    if (mpToken) {
      if (!email) { try { email = await emailDaConta(userId); } catch (e) { out.erros.push(`e-mail da conta: ${e?.message || e}`); } }
      if (!email) out.erros.push('sem e-mail da conta — mandatos do MP não conferidos');
      else {
        const r = await fetch(`${MP_BASE}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=20`, { headers: { Authorization: `Bearer ${mpToken}` } });
        if (!r.ok) throw new Error(`MP busca ${r.status}`);
        const d = await r.json();
        for (const p of d?.results || []) {
          const [uid, plano] = String(p.external_reference || '').split('|');
          if (uid !== String(userId) || !/^top2/.test(plano || '')) continue;
          const c = await fetch(`${MP_BASE}/preapproval/${p.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
          if (c.ok) out.mpCancelados.push(String(p.id)); else out.erros.push(`MP ${p.id}: ${c.status}`);
        }
      }
    }
    if (asaasKey()) {
      const cust = asaasCustomerId || await asaasIdDoPerfil(userId);
      if (cust) {
        const d = await asaasGet(`/subscriptions?customer=${encodeURIComponent(cust)}&status=ACTIVE&limit=20`);
        for (const s of d?.data || []) {
          if (!s?.id || s.maxPayments || !/^Investidor Pro/i.test(String(s.description || ''))) continue;
          try { await apagarAssinaturaAsaas(s.id); out.asaasCancelados.push(String(s.id)); }
          catch (e) { out.erros.push(`Asaas ${s.id}: ${e?.message || e}`); } // padrao-ok: motivo vai para out.erros, logado e alertado no fim
        }
      }
    }
    // O mandato do Pro cancelado não pode continuar contando como "tem Pro próprio" —
    // concluir_assessorias_entregues() lê mp_preapproval_id para decidir o papel na conclusão.
    if (out.mpCancelados.length) {
      const rp = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(userId)}&mp_preapproval_id=in.(${out.mpCancelados.join(',')})`, {
        method: 'PATCH', headers: { ...sbHdr(), Prefer: 'return=representation' }, body: JSON.stringify({ mp_preapproval_id: null }),
      });
      if (!rp.ok) out.erros.push(`perfis.mp_preapproval_id não limpo (${rp.status})`);
    }
  } catch (e) {
    out.erros.push(e?.message || String(e));
  }
  if (out.mpCancelados.length || out.asaasCancelados.length) {
    console.log(`[recorrencia-pro] ${origem}: user=${userId} mp=${out.mpCancelados.join(',') || '-'} asaas=${out.asaasCancelados.join(',') || '-'}`);
  }
  if (out.erros.length) {
    console.error(`[recorrencia-pro] ${origem}: falhas`, out.erros);
    alertarErro({ rota: `recorrencia-pro/${origem}`, erro: `Assessoria contratada mas a mensalidade do Investidor Pro NÃO foi cancelada — cliente ${userId} pode seguir sendo cobrado. Conferir MP/Asaas: ${out.erros.join(' | ')}`, extra: { userId } });
  }
  return out;
}
