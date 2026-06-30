/**
 * GET /api/proximidades-imovel?imovel_id=...   (logado)
 * On-demand: se o imóvel já tem pontos_proximos, devolve; senão calcula na hora
 * (OSM/Overpass), salva e devolve. Usado quando o imóvel é aberto antes do cron.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { consultarProximidades } from './_proximidades.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const id = new URL(req.url).searchParams.get('imovel_id');
  if (!id) return json({ error: 'imovel_id obrigatório' }, 400);

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=latitude,longitude,pontos_proximos,proximidades_em`)).json();
  if (!im) return json({ error: 'Imóvel não encontrado' }, 404);
  if (im.pontos_proximos) return json({ pontos: im.pontos_proximos, cache: true });

  const lat = Number(im.latitude), lng = Number(im.longitude);
  if (!lat || !lng) return json({ pontos: null, sem_coordenada: true });

  try {
    const pontos = await consultarProximidades(lat, lng);
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString() }) });
    return json({ pontos });
  } catch (e) {
    return json({ pontos: null, erro: String(e?.message || e) }, 200);
  }
}
