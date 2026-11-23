/**
 * POST /api/veiculo-assessoria-termo  { caso_id, cobrar? }
 * Gera o TERMO DE CONTRATAÇÃO DA ASSESSORIA DE VEÍCULO de um caso em veiculo_casos (e, com `cobrar`, a
 * cobrança avulsa do honorário de êxito: 5% do arremate, mínimo R$ 2.000 — regra_negocio, valor calculado
 * pelo banco). Idempotente: termo já aguardando/assinado devolve o mesmo link; cobrança já criada não duplica.
 *
 * SÓ admin/analista (dono, 23/11: assessoria de veículo é lançamento MANUAL, não está aberta ao público —
 * é a mesma porta de `veiculo_assessoria_pode_lancar()` no banco).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';
import { gerarTermoAssessoriaVeiculo } from './_termo-assessoria-veiculo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return json({ error: 'Assessoria de veículo é lançamento manual: apenas admin/analista.' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const casoId = String(body?.caso_id || '');
  if (!UUID.test(casoId)) return json({ error: 'caso_id inválido' }, 400);

  const r = await gerarTermoAssessoriaVeiculo(sb, { casoId, criadoPor: user.id, cobrar: body?.cobrar === true });
  if (!r.ok) return json({ error: r.motivo || 'termo não gerado' }, 422);
  return json({ ok: true, termo_url: r.url, ja_existia: !!r.jaExistia, status: r.status || 'aguardando_assinatura',
    cobranca_url: r.cobrancaUrl || null, ...(r.aviso ? { aviso: r.aviso } : {}) });
}
