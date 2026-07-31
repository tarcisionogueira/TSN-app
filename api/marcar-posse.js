/**
 * POST /api/marcar-posse — o cliente (ou admin/analista) sinaliza que TOMOU POSSE
 * do imóvel deste caso. Com a posse, o trabalho da ASSESSORIA daquele imóvel
 * ENCERRA. Regra de plano (decisão do dono, atualizada 30/07):
 *   - se o cliente já era Leilão Club ou Investidor Pro → MANTÉM o plano.
 *   - assessorado com OUTRO caso em aberto → mantém assessorado.
 *   - assessorado no ÚLTIMO caso → volta ao PLANO BASE: a mensalidade do Investidor
 *     Pro continua sendo cobrada durante toda a assessoria (prazo indeterminado),
 *     então se há assinatura Pro ativa nos gateways ele volta a 'top2' — só cai para
 *     Explorador se não houver recorrência ativa nenhuma.
 *
 * Body: { caso_id }
 * Usa service key: o role só muda no servidor (o trigger proteger_campos_sensiveis_perfil
 * bloqueia o cliente de mudar o próprio role direto).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };

// Roles que MANTÊM o plano após a posse (não são "assessorado"). 'suporte' incluído —
// se um usuário da equipe for cliente de um caso, a posse não pode reescrever o role dele.
const MANTEM_PLANO = ['top2', 'top2_anual', 'clube', 'clube_anual', 'admin', 'analista', 'advogado', 'consultor', 'suporte'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const casoId = body?.caso_id;
  if (!casoId) return json({ error: 'caso_id obrigatório' }, 400);

  // Carrega o caso e valida o vínculo: só o cliente do caso ou admin/analista.
  const [caso] = await (await sb(`casos?id=eq.${encodeURIComponent(casoId)}&select=id,cliente_id,posse_em&limit=1`)).json().catch(() => []);
  if (!caso) return json({ error: 'Caso não encontrado' }, 404);
  const role = await getUserRoleById(user.id);
  const ehStaff = role === 'admin' || role === 'analista';
  if (caso.cliente_id !== user.id && !ehStaff) return json({ error: 'Sem permissão para este caso.' }, 403);

  // Marca a posse (idempotente: mantém a 1ª data se já houver).
  const posseEm = caso.posse_em || new Date().toISOString();
  await sb(`casos?id=eq.${encodeURIComponent(casoId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ posse_em: posseEm, status_etapa: 'pos_arrematacao' }),
  });

  // Reavalia o plano do CLIENTE do caso (não do staff que clicou).
  const clienteId = caso.cliente_id;
  const [cliente] = await (await sb(`perfis?id=eq.${encodeURIComponent(clienteId)}&select=role,asaas_id,plano_ciclo,plano_pago_em&limit=1`)).json().catch(() => []);
  const roleCliente = cliente?.role || null;
  let reduziu = false, roleNovo = roleCliente, outroAberto = false;
  if (roleCliente && !MANTEM_PLANO.includes(roleCliente) && roleCliente !== 'explorador') {
    // A assessoria é POR IMÓVEL (caso), mas o plano é da CONTA. Só reavalia o role
    // quando ESTE era o ÚLTIMO caso em aberto do cliente — se ele ainda tem outro imóvel em
    // assessoria (posse_em nulo), mantém o plano até tomar posse de todos. Como já marcamos a
    // posse deste caso acima, a busca por outros abertos exclui este naturalmente.
    // Só conta como "em andamento" o caso REALMENTE arrematado e sem posse — um caso de
    // mera análise (nasce em 'analise_solicitada', arrematado_em nulo) não é assessoria
    // ativa e não pode manter o cliente como assessorado para sempre (bug bounty #6).
    const outros = await (await sb(`casos?cliente_id=eq.${encodeURIComponent(clienteId)}&id=neq.${encodeURIComponent(casoId)}&arrematado_em=not.is.null&posse_em=is.null&select=id&limit=1`)).json().catch(() => []);
    outroAberto = Array.isArray(outros) && outros.length > 0;
    if (!outroAberto) {
      // Último caso encerrado → volta ao PLANO BASE. A mensalidade do Pro seguiu sendo
      // cobrada durante a assessoria (regra do dono), então se há recorrência do Pro
      // ativa em qualquer gateway, o cliente volta a 'top2'; senão, Explorador.
      roleNovo = (await temAssinaturaProAtiva(clienteId, cliente)) ? 'top2' : 'explorador';
      await sb(`perfis?id=eq.${encodeURIComponent(clienteId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ role: roleNovo }),
      });
      reduziu = roleNovo === 'explorador';
    }
  }

  return json({ ok: true, posse_em: posseEm, reduziu, role_novo: roleNovo, mantido: !reduziu, outro_imovel_em_assessoria: outroAberto });
}

// Há Investidor Pro ATIVO por baixo da assessoria? Checa, nesta ordem: (a) recorrência
// MONTHLY no espelho local do MP; (b) Pro ANUAL — pagamento AVULSO, sem preapproval nem
// subscription (bug bounty #5): reconhecido pela âncora do perfil (plano_ciclo='anual' com
// plano_pago_em dentro de ~13 meses); (c) subscription ativa no Asaas (MONTHLY 49,90 ou
// YEARLY 449,90). A parcela de assessoria (500, 12×) NÃO conta como plano base.
async function temAssinaturaProAtiva(userId, cliente) {
  const asaasId = cliente?.asaas_id;
  try {
    const r = await sb(`mp_assinaturas?user_id=eq.${encodeURIComponent(userId)}&status=eq.authorized&plano_key=like.top2*&select=mp_assinatura_id&limit=1`);
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(rows) && rows.length > 0) return true;
  } catch { /* segue */ }
  // (b) Pro anual avulso: âncora do perfil (vigência de 13 meses cobre a folga da renovação).
  if (/anual/i.test(cliente?.plano_ciclo || '') && cliente?.plano_pago_em) {
    const pago = new Date(cliente.plano_pago_em).getTime();
    if (Number.isFinite(pago) && (Date.now() - pago) < 13 * 30 * 24 * 3600 * 1000) return true;
  }
  const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
  if (!asaasId || !ASAAS_KEY) return false;
  try {
    const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
    const r = await fetch(`${ASAAS_URL}/subscriptions?customer=${encodeURIComponent(asaasId)}&status=ACTIVE&limit=50`, { headers: { access_token: ASAAS_KEY } });
    if (!r.ok) return false;
    const data = await r.json().catch(() => null);
    return (data?.data || []).some(s => {
      const v = Number(s.value) || 0;
      return (s.cycle === 'MONTHLY' && v >= 40 && v <= 120) || (s.cycle === 'YEARLY' && v >= 350 && v <= 500);
    });
  } catch { return false; }
}
