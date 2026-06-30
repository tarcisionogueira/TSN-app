/**
 * POST /api/capturar-matricula-cef  (analista/admin)
 * Enfileira a captura automática dos documentos CEF (matrícula/edital/regra) de um
 * imóvel. O GitHub Actions processa a fila. Body: { imovel_id }
 *
 * Obs.: o fluxo de análise já enfileira sozinho quando não há documento. Este
 * endpoint é o atalho manual (botão "Buscar documentos na Caixa").
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, opts = {}) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }); }

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !['analista', 'admin'].includes(perfil.role)) return json({ error: 'Apenas analista/admin' }, 403);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { imovel_id } = b || {};
  if (!imovel_id) return json({ error: 'imovel_id obrigatório' }, 400);

  const [imovel] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovel_id)}&select=id,fonte,link_matricula,fonte_id`)).json();
  if (!imovel) return json({ error: 'Imóvel não encontrado' }, 404);
  if (!/caixa|cef/i.test(imovel.fonte || '')) return json({ error: 'Disponível apenas para imóveis da Caixa.' }, 400);
  const hdniip = (String(imovel.link_matricula || '').match(/hdniip=(\d+)/) || [])[1] || String(imovel.fonte_id || '').replace(/\D/g, '');
  if (!hdniip) return json({ error: 'Não foi possível identificar o imóvel na Caixa.' }, 400);

  await sb('cef_matricula_fila?on_conflict=imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ imovel_id: imovel.id, hdniip, status: 'pendente' }),
  });
  return json({ ok: true });
}
