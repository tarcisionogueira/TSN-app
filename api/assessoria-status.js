/**
 * GET /api/assessoria-status — pode o usuário logado CONTRATAR uma assessoria agora?
 *
 * Regra do dono (30/07): a assessoria é uma operação INDIVIDUAL (1 arrematação por
 * contrato). O cliente contrata UMA por vez; ao SINALIZAR a arrematação do imóvel
 * ("Arrematei"), pode contratar a próxima — mesmo antes de sinalizar a venda/posse.
 * Leilão Club não contrata avulsa (arrematações ilimitadas já inclusas no plano).
 *
 * Resposta: { podeContratar, motivo, role }
 *   motivo: 'ok' | 'nova_arrematacao' (já arrematou a anterior, liberado) |
 *           'assessoria_em_andamento' | 'clube_incluido' | 'requer_pro'
 *
 * Lido pelo Checkout (gate servidor-side espelhado na tela) e pela página de Planos
 * (CTA "Contratar nova arrematação" para quem já é assessorado).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);

  if (/^clube/.test(role || '')) return json({ podeContratar: false, motivo: 'clube_incluido', role });
  if (['admin', 'analista', 'advogado', 'suporte'].includes(role)) return json({ podeContratar: true, motivo: 'ok', role });
  if (!/^(top2|assessorado)/.test(role || '')) return json({ podeContratar: false, motivo: 'requer_pro', role });

  // Última assessoria CONTRATADA (contrato vivo — aguardando assinatura ou assinado).
  // Cancelado/expirado não trava: o cliente desistiu antes de a operação existir.
  const rc = await sb(`contratos_link?criado_por=eq.${encodeURIComponent(user.id)}&plano_key=eq.assessorado&status=in.(aguardando,aguardando_assinatura,assinado)&select=id,criado_em&order=criado_em.desc&limit=1`);
  const [contrato] = rc.ok ? await rc.json().catch(() => []) : [];
  if (!contrato) return json({ podeContratar: true, motivo: 'ok', role });

  // Arremate SINALIZADO depois desse contrato? (os dois universos: o portfólio
  // auto-declarado "arrematados" — botão "Arrematei" — e o caso da equipe.)
  const desde = encodeURIComponent(contrato.criado_em);
  const [ra, rk] = await Promise.all([
    sb(`arrematados?user_id=eq.${encodeURIComponent(user.id)}&created_at=gt.${desde}&select=id&limit=1`),
    sb(`casos?cliente_id=eq.${encodeURIComponent(user.id)}&arrematado_em=gt.${desde}&select=id&limit=1`),
  ]);
  const arrDepois  = ra.ok ? await ra.json().catch(() => []) : [];
  const casoDepois = rk.ok ? await rk.json().catch(() => []) : [];
  const arrematou = (arrDepois?.length || 0) > 0 || (casoDepois?.length || 0) > 0;

  return arrematou
    ? json({ podeContratar: true, motivo: 'nova_arrematacao', role })
    : json({ podeContratar: false, motivo: 'assessoria_em_andamento', role });
}
