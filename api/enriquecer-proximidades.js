/**
 * GET /api/enriquecer-proximidades  (cron)
 * Para imóveis já geocodificados que ainda não têm `pontos_proximos`, consulta o
 * OpenStreetMap (Overpass, grátis) e guarda o ponto MAIS PRÓXIMO de cada categoria
 * (praia, transporte, mercado, farmácia, saúde, escola, shopping) com a distância.
 * Processa em lotes pequenos (Overpass é lento/rate-limited).
 */
export const config = { runtime: 'edge', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { consultarProximidades } from './_proximidades.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE = Number(process.env.PROXIMIDADES_LOTE || 12);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  const fila = await (await sb(`imoveis_leilao?select=id,latitude,longitude&proximidades_em=is.null&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=atualizado_em.desc&limit=${LOTE}`)).json();
  let ok = 0, falhas = 0;
  for (const im of (Array.isArray(fila) ? fila : [])) {
    try {
      const pontos = await consultarProximidades(Number(im.latitude), Number(im.longitude));
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString() }) });
      ok++;
    } catch (_) {
      // marca a tentativa para não travar a fila (tenta de novo no próximo ciclo só se quiser)
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ proximidades_em: new Date().toISOString() }) }).catch(() => {});
      falhas++;
    }
  }
  return new Response(JSON.stringify({ ok, falhas, lote: LOTE }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
