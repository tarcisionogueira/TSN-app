/**
 * POST /api/termo-atribuido?arrematacao=<uuid>  (ou body { arrematacao_id })
 *
 * Gera o TERMO DE ASSESSORIA + PROCURAÇÃO de uma arrematação atribuída que ficou sem termo — o
 * caso das atribuições anteriores a 30/09 (Marcos Araujo: êxito pago em 17/09, nada assinado).
 * Idempotente: se já houver termo aguardando ou assinado, devolve o mesmo link.
 * Admin/analista, ou CRON_SECRET (cron-manual.yml) para a equipe gerar sem abrir tela.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById, isCronAuthorized } from './_auth.js';
import { gerarTermoAtribuido } from './_termo-assessoria.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

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

  let criadoPor = null;
  if (!isCronAuthorized(req)) {
    const user = await getAuthUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    const role = await getUserRoleById(user.id);
    if (role !== 'admin' && role !== 'analista') return json({ error: 'Apenas admin/analista.' }, 403);
    criadoPor = user.id;
  }

  let body = {};
  try { body = await req.json(); } catch { /* corpo vazio (cron-manual manda {}) — vale a query */ }
  const id = String(new URL(req.url).searchParams.get('arrematacao') || body?.arrematacao_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'arrematacao (uuid) obrigatório' }, 400);

  const r = await gerarTermoAtribuido(sb, { arrematacaoId: id, criadoPor });
  return json(r, r.ok ? 200 : 502);
}
