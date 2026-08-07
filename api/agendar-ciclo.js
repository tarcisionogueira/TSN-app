/**
 * POST /api/agendar-ciclo — regra (b) do dono: ANUAL → MENSAL ao FIM dos 12 meses.
 *
 * Não cobra agora. Marca perfis.ciclo_agendado='mensal' (server-autoritativo) e CANCELA a
 * auto-renovação ANUAL nos dois gateways (senão a regra c recobra 449,90 no vencimento). O
 * acesso é preservado até plano_vencimento pela âncora do perfil — o cancelamento do mandato
 * NÃO rebaixa (suspenderPlanoDireto tem a guarda 'anual_vigente'). A mensal é materializada
 * no vencimento (o cliente reautoriza o cartão por e-mail perto da virada — MP/Asaas exigem
 * consentimento; nunca cobramos em silêncio).
 *
 * Body: { alvo: 'mensal' }  (único destino suportado hoje)
 * Segurança: lê o PRÓPRIO perfil (service key), nunca confia no body (anti-IDOR/P1.5).
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const MP_URL = 'https://api.mercadopago.com';
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();

function sb(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Cancela o preapproval ANUAL do usuário no MP (busca escopada por external_reference +
// candidatos do perfil). Só remove a auto-renovação — o acesso segue pela âncora.
async function cancelarMP(candidatos, email, userId) {
  if (!MP_TOKEN) return 0;
  const ids = new Set();
  try {
    if (email && userId) {
      const r = await fetch(`${MP_URL}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      const d = await r.json().catch(() => null);
      for (const p of (d?.results || [])) {
        if (String(p.external_reference || '').split('|')[0] === userId && p.id) ids.add(String(p.id));
      }
    }
  } catch { /* segue com candidatos */ }
  for (const c of (candidatos || [])) if (c) ids.add(String(c));
  let n = 0;
  for (const id of ids) {
    try {
      const pr = await fetch(`${MP_URL}/preapproval/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      if (pr.ok) n++;
    } catch { /* best-effort por id */ }
  }
  return n;
}

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
  const ip = getIP(req);
  const rl = await checkRateLimit(`agendar-ciclo:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }

  const alvo = String(req.body?.alvo || 'mensal');
  if (alvo !== 'mensal') { res.status(400).json({ error: 'Destino não suportado' }); return; }

  // SERVER-AUTORITATIVO: só o próprio perfil decide elegibilidade e vencimento (anti-IDOR).
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role,plano_ciclo,plano_vencimento,asaas_id,mp_id,mp_preapproval_id`)).json().catch(() => []);
  if (!perfil) { res.status(404).json({ error: 'Perfil não encontrado' }); return; }
  if (!/anual/i.test(perfil.plano_ciclo || '')) {
    res.status(400).json({ error: 'Você não tem um plano anual para agendar a mudança.' }); return;
  }

  // 1) Cancela a auto-renovação ANUAL nos dois gateways (acesso preservado até o vencimento
  //    pela âncora — suspenderPlanoDireto tem a guarda 'anual_vigente').
  const cancelados = (await cancelarMP([perfil.mp_preapproval_id, perfil.mp_id], user.email, user.id)) + (await cancelarAsaas(perfil.asaas_id));

  // 2) CONFIRMA que nenhum mandato anual sobreviveu (B2): cancelamento é best-effort e uma
  //    falha silenciosa deixaria a regra c recobrar 449,90 no vencimento. Se NÃO der para
  //    confirmar (mandato remanescente OU consulta falhou), NÃO agenda — o cliente reexecuta.
  const conf = await confirmarSemMandato(perfil.asaas_id, user.email, user.id);
  if (!conf.ok) {
    return res.status(conf.erro ? 502 : 409).json({
      error: 'nao_confirmado',
      msg: 'Não foi possível confirmar o cancelamento da renovação anual agora. Tente novamente em instantes — nenhuma mudança foi agendada.',
    });
  }

  // 3) Só agora marca a intenção (materializada no vencimento pelo cron / próxima mensal).
  //    ESTA ESCRITA NÃO PODE SER ENGOLIDA (07/08): o efeito IRREVERSÍVEL já aconteceu nos
  //    passos 1 e 2 — a renovação anual foi cancelada nos dois gateways. Se a intenção
  //    'mensal' não ficar gravada, no vencimento o cliente simplesmente PERDE o plano em vez
  //    de migrar para a mensal, e ninguém fica sabendo. O `.catch(() => {})` transformava
  //    exatamente isso num sucesso silencioso. Agora falha alto, com instrução ao suporte.
  const pat = await sb(`perfis?id=eq.${user.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ciclo_agendado: 'mensal' }),
  }).catch(() => null);
  if (!pat || !pat.ok) {
    const corpo = pat ? await pat.text().catch(() => '') : 'sem resposta';
    console.error('[agendar-ciclo] PATCH ciclo_agendado falhou', pat?.status, String(corpo).slice(0, 200));
    try { auditLog({ acao: 'ciclo_agendado_falha_gravacao', user_id: user.id, ip, detalhes: { cancelados, http: pat?.status || null }, sucesso: false }); } catch { /* auditoria best-effort */ }
    return res.status(502).json({
      error: 'agendamento_nao_gravado',
      msg: 'A renovação anual foi cancelada, mas não conseguimos agendar a mensal agora. Fale com o suporte para concluir a troca antes do vencimento.',
    });
  }

  auditLog({ acao: 'ciclo_agendado_mensal', user_id: user.id, ip, detalhes: { ate: perfil.plano_vencimento, cancelados }, sucesso: true });
  return res.status(200).json({ ok: true, agendado: 'mensal', ate: perfil.plano_vencimento, cancelados });
}

// Confirma que NÃO resta mandato recorrente do usuário (MP authorized OU Asaas ACTIVE).
// { ok:true } = confirmado sem mandato. { ok:false, erro } = mandato vivo (erro=false) ou
// consulta falhou (erro=true) → não devemos agendar (conservador).
async function confirmarSemMandato(asaasId, email, userId) {
  // MP
  if (MP_TOKEN && email) {
    try {
      const r = await fetch(`${MP_URL}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=20`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      if (!r.ok) return { ok: false, erro: true };
      const d = await r.json().catch(() => null);
      if (d == null) return { ok: false, erro: true };
      const vivo = (d.results || []).some(p => String(p.external_reference || '').split('|')[0] === userId);
      if (vivo) return { ok: false, erro: false };
    } catch { return { ok: false, erro: true }; }
  }
  // Asaas
  if (ASAAS_KEY && asaasId) {
    try {
      const r = await fetch(`${ASAAS_URL}/subscriptions?customer=${encodeURIComponent(asaasId)}&status=ACTIVE&limit=1`, { headers: { access_token: ASAAS_KEY } });
      if (!r.ok) return { ok: false, erro: true };
      const d = await r.json().catch(() => null);
      if (d == null) return { ok: false, erro: true };
      if ((d.data || []).length > 0) return { ok: false, erro: false };
    } catch { return { ok: false, erro: true }; }
  }
  return { ok: true };
}
