/**
 * POST /api/garantia-cancelar — botão único de cancelamento no perfil do cliente.
 *
 * Regra (CDC art. 49 — direito de arrependimento):
 *  - DENTRO de 7 dias da 1ª assinatura (perfis.plano_pago_em): cancela a recorrência,
 *    rebaixa para explorador NA HORA, zera a âncora e registra um pedido de reembolso
 *    100% (reembolsos_garantia). O estorno é conferido/executado pelo admin no painel
 *    do gateway (registro auditável aqui) — o cliente recebe confirmação por e-mail.
 *  - APÓS 7 dias: só cancela a RENOVAÇÃO (para futuras cobranças). O acesso segue até o
 *    fim do período já pago; sem reembolso.
 *
 * O mesmo botão serve os dois casos — o texto muda no front conforme a janela.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { enviarEmail } from './_email.js';
import { hashCpf, cpfDoRegistro } from './_cpf.js';

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const MP_URL = 'https://api.mercadopago.com';
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
const EMAIL_FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();

const PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
const JANELA_MS = 7 * 24 * 3600 * 1000;

function sb(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Cancela a assinatura recorrente do MP.
// Cancela pelo preapproval id do PRÓPRIO usuário (perfis.mp_id). Não usa o e-mail
// como chave: e-mail pode ter homônimo/conta compartilhada no MP e cancelaria a
// assinatura de um terceiro. No fallback (sem mp_id salvo) a busca por e-mail é
// FILTRADA pelo external_reference `${userId}|plano`, garantindo o escopo do usuário.
async function cancelarMP(mpId, email, userId) {
  if (!MP_TOKEN) return 0;
  let cancelados = 0;
  try {
    let ids = [];
    if (mpId) {
      ids = [mpId];
    } else if (email && userId) {
      const r = await fetch(`${MP_URL}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      const d = await r.json().catch(() => null);
      ids = (d?.results || [])
        .filter(p => String(p.external_reference || '').split('|')[0] === userId)
        .map(p => p.id).filter(Boolean);
    }
    for (const id of ids) {
      const pr = await fetch(`${MP_URL}/preapproval/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      if (pr.ok) cancelados++;
    }
  } catch { /* best-effort */ }
  return cancelados;
}

// Cancela a assinatura recorrente do Asaas (por customer do e-mail).
// Cancela pelo customer id do PRÓPRIO usuário (perfil.asaas_id), não por e-mail —
// e-mail pode ter duplicata/homônimo no Asaas e cancelaria assinatura de terceiro.
async function cancelarAsaas(customerId) {
  if (!ASAAS_KEY || !customerId) return 0;
  try {
    const sr = await fetch(`${ASAAS_URL}/subscriptions?customer=${encodeURIComponent(customerId)}&status=ACTIVE`, { headers: { access_token: ASAAS_KEY } });
    const subs = (await sr.json().catch(() => null))?.data || [];
    let n = 0;
    for (const s of subs) {
      const dr = await fetch(`${ASAAS_URL}/subscriptions/${s.id}`, { method: 'DELETE', headers: { access_token: ASAAS_KEY } });
      if (dr.ok) n++;
    }
    return n;
  } catch { return 0; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
  const email = user.email || null;

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role,role_anterior,plano_pago_em,mp_id,asaas_id,nome,cpf,cpf_enc`)).json().catch(() => []);
  if (!perfil) { res.status(404).json({ error: 'Perfil não encontrado' }); return; }

  const rolePagante = PAGANTES.includes(perfil.role) ? perfil.role : (PAGANTES.includes(perfil.role_anterior) ? perfil.role_anterior : null);
  if (!rolePagante) { res.status(200).json({ ok: true, semAssinatura: true, msg: 'Não há assinatura paga ativa para cancelar.' }); return; }

  const gateway = perfil.mp_id ? 'mercadopago' : perfil.asaas_id ? 'asaas' : 'desconhecido';
  const dentro7 = perfil.plano_pago_em && (Date.now() - new Date(perfil.plano_pago_em).getTime() <= JANELA_MS);

  // Garantia é UMA VEZ POR CPF: apura o hash do CPF do cliente e verifica se esse CPF
  // já exerceu a garantia antes (impede o loop assinar→reembolsar→assinar→reembolsar,
  // inclusive recriando conta com o mesmo CPF).
  let cpfHash = null, jaUsouGarantia = false;
  try {
    const cpf = await cpfDoRegistro(perfil);
    cpfHash = cpf ? await hashCpf(cpf) : null;
    if (cpfHash) {
      const [ja] = await (await sb(`reembolsos_garantia?cpf_hash=eq.${encodeURIComponent(cpfHash)}&select=id&limit=1`)).json().catch(() => []);
      jaUsouGarantia = !!ja;
    }
  } catch { /* sem CPF apurável → segue sem bloquear o cancelamento (só não reembolsa 2x) */ }
  const podeReembolso = dentro7 && !jaUsouGarantia;

  // 1) Cancela a recorrência nos gateways (best-effort nos dois).
  const cancelados = (await cancelarMP(perfil.mp_id, email, user.id)) + (await cancelarAsaas(perfil.asaas_id));

  if (podeReembolso) {
    // 2) Rebaixa AGORA + zera a âncora (a garantia foi exercida).
    await sb(`perfis?id=eq.${user.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'explorador', role_anterior: null, plano_pago_em: null }),
    }).catch(() => {});

    // valor de referência do plano (para o admin conferir o estorno)
    let valorRef = null;
    try {
      // Coluna é `preco` ('valor' não existe em planos_config — o 42703 deixava o
      // valor_ref sempre null no registro/e-mail do admin). Variante _anual usa preco_anual.
      const base = rolePagante.replace(/_anual$/, '');
      const [pc] = await (await sb(`planos_config?plano_key=eq.${encodeURIComponent(base)}&select=preco,preco_anual&limit=1`)).json();
      valorRef = /_anual$/.test(rolePagante) ? (pc?.preco_anual ?? pc?.preco ?? null) : (pc?.preco ?? null);
    } catch { /* opcional */ }

    // 3) Registra o pedido de reembolso (canal auditável p/ o admin executar o estorno).
    await sb('reembolsos_garantia', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: user.id, nome: perfil.nome || null, email, plano: rolePagante, valor_ref: valorRef, gateway, status: 'solicitado', motivo: 'Garantia de 7 dias (CDC art. 49)', cpf_hash: cpfHash }),
    }).catch(() => {});

    // 4) E-mails (cliente + admin). Não bloqueiam a resposta.
    try {
      if (email) await enviarEmail({ from: EMAIL_FROM, to: email, subject: 'Cancelamento confirmado e reembolso em processamento — BidPro Brasil', html: `<p>Olá${perfil.nome ? ', ' + perfil.nome : ''}!</p><p>Confirmamos o <strong>cancelamento da sua assinatura</strong> dentro da <strong>garantia de 7 dias</strong>. O reembolso de 100% do valor pago está em processamento e cai no mesmo meio de pagamento em alguns dias úteis.</p><p>Seu acesso voltou ao plano Explorador. Obrigado por testar a BidPro Brasil.</p>` });
      if (ADMIN_EMAIL) await enviarEmail({ from: EMAIL_FROM, to: ADMIN_EMAIL, subject: `Reembolso garantia 7 dias — ${perfil.nome || email}`, html: `<p>Processar estorno no ${gateway}:</p><ul><li>Cliente: ${perfil.nome || '—'} (${email || '—'})</li><li>Plano: ${rolePagante}${valorRef ? ` — R$ ${Number(valorRef).toFixed(2)}` : ''}</li><li>Assinaturas canceladas no gateway: ${cancelados}</li></ul><p>Registrado em Admin → Prestação de contas → Reembolsos.</p>` });
    } catch { /* não bloqueia */ }

    res.status(200).json({ ok: true, reembolso: true, dentro7: true, cancelados, msg: 'Assinatura cancelada. Reembolso de 100% em processamento.' });
    return;
  }

  // Após 7 dias OU garantia já usada por este CPF: só cancela a renovação; acesso segue
  // até o fim do período pago; sem novo reembolso.
  const msgFim = jaUsouGarantia
    ? 'Renovação cancelada. A garantia de 7 dias já foi utilizada com este CPF, então não há novo reembolso; seu acesso continua até o fim do período já pago.'
    : 'Renovação cancelada. Seu acesso continua até o fim do período já pago.';
  res.status(200).json({ ok: true, reembolso: false, dentro7, garantiaJaUsada: jaUsouGarantia, cancelados, renovacaoCancelada: cancelados > 0, msg: msgFim });
}
