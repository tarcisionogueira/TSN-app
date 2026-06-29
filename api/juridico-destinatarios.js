/**
 * /api/juridico-destinatarios  (admin/analista)
 * Gerencia a lista de destinatários do jurídico (Para/Cópia).
 *  GET    -> lista
 *  POST   -> upsert { id?, nome, email, papel, copia, ativo }
 *  DELETE -> { id }
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
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !ROLES.includes(perfil.role)) return json({ error: 'Apenas equipe' }, 403);

  // Advogado só enxerga/gerencia os próprios; admin/analista veem todos.
  const ehAdvogado = perfil.role === 'advogado';
  const filtroDono = ehAdvogado ? `&advogado_id=eq.${user.id}` : '';

  if (req.method === 'GET') {
    const lista = await (await sb(`juridico_destinatarios?select=*${filtroDono}&order=copia.asc,criado_em.asc`)).json();
    return json({ destinatarios: Array.isArray(lista) ? lista : [] });
  }

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const email = String(b?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return json({ error: 'E-mail inválido' }, 400);
    const row = { nome: b.nome || null, email, papel: b.papel || null, copia: b.copia !== false, ativo: b.ativo !== false };
    // advogado: força o vínculo a si mesmo; admin/analista podem direcionar a um advogado.
    if (ehAdvogado) row.advogado_id = user.id;
    else if (b.advogado_id !== undefined) row.advogado_id = b.advogado_id || null;
    if (b.id) {
      await sb(`juridico_destinatarios?id=eq.${encodeURIComponent(b.id)}${filtroDono}`, { method: 'PATCH', prefer: 'return=minimal', body: row });
    } else {
      await sb('juridico_destinatarios', { method: 'POST', prefer: 'return=minimal', body: row });
    }
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    if (!b?.id) return json({ error: 'id obrigatório' }, 400);
    await sb(`juridico_destinatarios?id=eq.${encodeURIComponent(b.id)}${filtroDono}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
