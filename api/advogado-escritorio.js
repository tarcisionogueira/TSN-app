/**
 * /api/advogado-escritorio  (advogado/admin)
 *  GET  -> dados do escritório do advogado logado
 *  POST -> salva { razao_social, cnpj, oab, telefone, endereco, observacoes }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !['advogado', 'admin'].includes(perfil.role)) return json({ error: 'Apenas advogado' }, 403);

  if (req.method === 'GET') {
    const [esc] = await (await sb(`advogado_escritorio?advogado_id=eq.${user.id}&select=*`)).json();
    return json({ escritorio: esc || null });
  }

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const row = {
      advogado_id: user.id,
      razao_social: b.razao_social || null, cnpj: b.cnpj || null, oab: b.oab || null,
      telefone: b.telefone || null, endereco: b.endereco || null, observacoes: b.observacoes || null,
      atualizado_em: new Date().toISOString(),
    };
    await sb('advogado_escritorio?on_conflict=advogado_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: row });
    return json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
