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
import { podeContratarAssessoria } from './_assessoria.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);
  // Regra compartilhada com os endpoints de pagamento (fonte única em _assessoria.js).
  const r = await podeContratarAssessoria({ userId: user.id, email: user.email, role });
  return json({ ...r, role });
}
