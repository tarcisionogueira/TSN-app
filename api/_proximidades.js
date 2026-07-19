/**
 * Helper de proximidades via OpenStreetMap/Overpass (grátis).
 * Reusado pelo cron (enriquecer-proximidades) e pelo on-demand (proximidades-imovel).
 */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const RAIO = 4000; // metros

// Categorias → tags OSM. Chaves iguais às usadas na UI (CATS_PROX).
// Base dos scores de atratividade (revenda/locação/temporada). Positivos + NEGATIVOS
// (deságio). classifica() devolve a 1ª categoria que casar — 'negativo' fica por último.
export const CATEGORIAS = [
  { key: 'praia',        tags: [['natural', 'beach']] },
  { key: 'transporte',   tags: [['highway', 'bus_stop'], ['railway', 'station'], ['station', 'subway'], ['railway', 'subway_entrance']] },
  { key: 'mercado',      tags: [['shop', 'supermarket']] },
  { key: 'farmacia',     tags: [['amenity', 'pharmacy']] },
  // saude: hospital + UPA + posto/UBS (tagueamento BR é irregular → rede ampla).
  { key: 'saude',        tags: [['amenity', 'hospital'], ['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'centre']] },
  { key: 'escola',       tags: [['amenity', 'school']] },   // pública + particular (OSM não separa)
  { key: 'universidade', tags: [['amenity', 'university'], ['amenity', 'college']] },
  { key: 'shopping',     tags: [['shop', 'mall']] },
  { key: 'turismo',      tags: [['tourism', 'attraction'], ['tourism', 'museum'], ['tourism', 'theme_park'], ['tourism', 'viewpoint'], ['historic', 'monument'], ['historic', 'castle']] },
  { key: 'eventos',      tags: [['amenity', 'events_venue'], ['amenity', 'conference_centre'], ['leisure', 'stadium'], ['tourism', 'hotel']] },
  // NEGATIVOS (deságio no score): presídio, aterro/lixão, ETE (Sabesp), subestação, cemitério.
  { key: 'negativo',     tags: [['amenity', 'prison'], ['landuse', 'landfill'], ['man_made', 'wastewater_plant'], ['power', 'substation'], ['landuse', 'cemetery'], ['amenity', 'grave_yard']] },
];

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function classifica(tags) {
  for (const c of CATEGORIAS) if (c.tags.some(([k, v]) => tags?.[k] === v)) return c.key;
  return null;
}

/** Consulta o Overpass e retorna o ponto mais próximo de cada categoria. */
export async function consultarProximidades(lat, lng) {
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
