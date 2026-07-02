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

// Cancela a assinatura recorrente do MP (busca preapprovals autorizados do pagador).
async function cancelarMP(email) {
  if (!MP_TOKEN || !email) return 0;
  let cancelados = 0;
  try {
    const r = await fetch(`${MP_URL}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
    const d = await r.json().catch(() => null);
    const ids = (d?.results || []).map(p => p.id).filter(Boolean);
    for (const id of ids) {
      const pr = await fetch(`${MP_URL}/preapproval/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      if (pr.ok) cancelados++;
    }
  } catch { /* best-effort */ }
  return cancelados;
}

// Cancela a assinatura recorrente do Asaas (por customer do e-mail).
async function cancelarAsaas(email) {
  if (!ASAAS_KEY || !email) return 0;
  try {
    const cr = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, { headers: { access_token: ASAAS_KEY } });
    const customer = (await cr.json().catch(() => null))?.data?.[0];
    if (!customer) return 0;
    const sr = await fetch(`${ASAAS_URL}/subscriptions?customer=${customer.id}&status=ACTIVE`, { headers: { access_token: ASAAS_KEY } });
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

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role,role_anterior,plano_pago_em,mp_id,asaas_id,nome`)).json().catch(() => []);
  if (!perfil) { res.status(404).json({ error: 'Perfil não encontrado' }); return; }

  const rolePagante = PAGANTES.includes(perfil.role) ? perfil.role : (PAGANTES.includes(perfil.role_anterior) ? perfil.role_anterior : null);
  if (!rolePagante) { res.status(200).json({ ok: true, semAssinatura: true, msg: 'Não há assinatura paga ativa para cancelar.' }); return; }

  const gateway = perfil.mp_id ? 'mercadopago' : perfil.asaas_id ? 'asaas' : 'desconhecido';
  const dentro7 = perfil.plano_pago_em && (Date.now() - new Date(perfil.plano_pago_em).getTime() <= JANELA_MS);

  // 1) Cancela a recorrência nos gateways (best-effort nos dois).
  const cancelados = (await cancelarMP(email)) + (await cancelarAsaas(email));

  if (dentro7) {
    // 2) Rebaixa AGORA + zera a âncora (a garantia foi exercida).
    await sb(`perfis?id=eq.${user.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'explorador', role_anterior: null, plano_pago_em: null }),
    }).catch(() => {});

    // valor de referência do plano (para o admin conferir o estorno)
    let valorRef = null;
    try {
      const [pc] = await (await sb(`planos_config?plano_key=eq.${encodeURIComponent(rolePagante)}&select=valor&limit=1`)).json();
      valorRef = pc?.valor ?? null;
    } catch { /* opcional */ }

    // 3) Registra o pedido de reembolso (canal auditável p/ o admin executar o estorno).
    await sb('reembolsos_garantia', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: user.id, nome: perfil.nome || null, email, plano: rolePagante, valor_ref: valorRef, gateway, status: 'solicitado', motivo: 'Garantia de 7 dias (CDC art. 49)' }),
    }).catch(() => {});

    // 4) E-mails (cliente + admin). Não bloqueiam a resposta.
    try {
      if (email) await enviarEmail({ from: EMAIL_FROM, to: email, subject: 'Cancelamento confirmado e reembolso em processamento — BidPro Brasil', html: `<p>Olá${perfil.nome ? ', ' + perfil.nome : ''}!</p><p>Confirmamos o <strong>cancelamento da sua assinatura</strong> dentro da <strong>garantia de 7 dias</strong>. O reembolso de 100% do valor pago está em processamento e cai no mesmo meio de pagamento em alguns dias úteis.</p><p>Seu acesso voltou ao plano Explorador. Obrigado por testar a BidPro Brasil.</p>` });
      if (ADMIN_EMAIL) await enviarEmail({ from: EMAIL_FROM, to: ADMIN_EMAIL, subject: `Reembolso garantia 7 dias — ${perfil.nome || email}`, html: `<p>Processar estorno no ${gateway}:</p><ul><li>Cliente: ${perfil.nome || '—'} (${email || '—'})</li><li>Plano: ${rolePagante}${valorRef ? ` — R$ ${Number(valorRef).toFixed(2)}` : ''}</li><li>Assinaturas canceladas no gateway: ${cancelados}</li></ul><p>Registrado em Admin → Prestação de contas → Reembolsos.</p>` });
    } catch { /* não bloqueia */ }

    res.status(200).json({ ok: true, reembolso: true, dentro7: true, cancelados, msg: 'Assinatura cancelada. Reembolso de 100% em processamento.' });
    return;
  }

  // Após 7 dias: só cancela a renovação; acesso segue até o fim do período pago.
  res.status(200).json({ ok: true, reembolso: false, dentro7: false, cancelados, renovacaoCancelada: cancelados > 0, msg: 'Renovação cancelada. Seu acesso continua até o fim do período já pago.' });
}
