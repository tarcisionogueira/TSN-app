/**
 * GET /api/enriquecer-proximidades  (cron)
 * Para imóveis já geocodificados que ainda não têm `pontos_proximos`, consulta o
 * OpenStreetMap (Overpass, grátis) e guarda o ponto MAIS PRÓXIMO de cada categoria
 * (praia, transporte, mercado, farmácia, saúde, escola, shopping) com a distância.
 * Processa em lotes pequenos (Overpass é lento/rate-limited).
 */
export const config = { runtime: 'edge', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const RAIO = 4000; // metros
const LOTE = Number(process.env.PROXIMIDADES_LOTE || 12);

// Categorias → tags OSM. A ordem/identidade é compartilhada com a UI (cor/emoji lá).
const CATEGORIAS = [
  { key: 'praia',      tags: [['natural', 'beach']] },
  { key: 'transporte', tags: [['highway', 'bus_stop'], ['railway', 'station'], ['station', 'subway'], ['railway', 'subway_entrance']] },
  { key: 'mercado',    tags: [['shop', 'supermarket']] },
  { key: 'farmacia',   tags: [['amenity', 'pharmacy']] },
  { key: 'saude',      tags: [['amenity', 'hospital'], ['amenity', 'clinic']] },
  { key: 'escola',     tags: [['amenity', 'school']] },
  { key: 'shopping',   tags: [['shop', 'mall']] },
];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function classifica(tags) {
  for (const c of CATEGORIAS) {
    if (c.tags.some(([k, v]) => tags?.[k] === v)) return c.key;
  }
  return null;
}

async function consultarOverpass(lat, lng) {
  const blocos = CATEGORIAS.flatMap(c => c.tags.map(([k, v]) => `nwr["${k}"="${v}"](around:${RAIO},${lat},${lng});`)).join('');
  const query = `[out:json][timeout:25];(${blocos});out center tags;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const data = await res.json();
  const melhores = {};
  for (const el of (data.elements || [])) {
    const plat = el.lat ?? el.center?.lat, plng = el.lon ?? el.center?.lon;
    if (plat == null || plng == null) continue;
    const cat = classifica(el.tags || {});
    if (!cat) continue;
    const dist = haversine(lat, lng, plat, plng);
    if (!melhores[cat] || dist < melhores[cat].dist_m) {
      melhores[cat] = { nome: el.tags?.name || null, dist_m: dist, lat: plat, lng: plng };
    }
  }
  return melhores;
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  const fila = await (await sb(`imoveis_leilao?select=id,latitude,longitude&proximidades_em=is.null&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=atualizado_em.desc&limit=${LOTE}`)).json();
  let ok = 0, falhas = 0;
  for (const im of (Array.isArray(fila) ? fila : [])) {
    try {
      const pontos = await consultarOverpass(Number(im.latitude), Number(im.longitude));
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
