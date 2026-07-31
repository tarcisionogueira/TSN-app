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

  // 1) Marca a intenção (materializada no vencimento pelo cron / próxima mensal confirmada).
  await sb(`perfis?id=eq.${user.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ciclo_agendado: 'mensal' }),
  }).catch(() => {});

  // 2) Cancela a auto-renovação ANUAL nos dois gateways (acesso preservado até o vencimento
  //    pela âncora — suspenderPlanoDireto tem a guarda 'anual_vigente').
  const cancelados = (await cancelarMP([perfil.mp_preapproval_id, perfil.mp_id], user.email, user.id)) + (await cancelarAsaas(perfil.asaas_id));

  auditLog({ acao: 'ciclo_agendado_mensal', user_id: user.id, ip, detalhes: { ate: perfil.plano_vencimento, cancelados }, sucesso: true });
  return res.status(200).json({ ok: true, agendado: 'mensal', ate: perfil.plano_vencimento, cancelados });
}
