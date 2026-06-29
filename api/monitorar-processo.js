/**
 * POST /api/monitorar-processo   (analista/advogado/admin)
 * Marca/atualiza/desativa o monitoramento de um processo no CNJ.
 * Body: { numero_processo, uf?, caso_id?, imovel_id?, rotulo?, ativo? }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ROLES = ['admin', 'analista', 'advogado'];

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !ROLES.includes(perfil.role)) return json({ error: 'Apenas equipe' }, 403);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const numero = String(b?.numero_processo || '').trim();
  if (!numero) return json({ error: 'numero_processo obrigatório' }, 400);

  const row = {
    numero_processo: numero,
    uf: b.uf || null,
    caso_id: b.caso_id || null,
    imovel_id: b.imovel_id || null,
    rotulo: b.rotulo || null,
    ativo: b.ativo === false ? false : true,
    criado_por: user.id,
  };
  // upsert por numero_processo
  await sb('processos_monitorados?on_conflict=numero_processo', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: row,
  });
  return json({ ok: true, ativo: row.ativo });
}
