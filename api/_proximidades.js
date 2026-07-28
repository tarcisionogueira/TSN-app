/**
 * Helper de proximidades via OpenStreetMap/Overpass (grátis).
 * Reusado pelo cron (enriquecer-proximidades) e pelo on-demand (proximidades-imovel).
 */
// Instâncias públicas do Overpass, em ordem. A primeira costuma limitar (429) nos
// horários de pico; sem espelho, um 429 zerava os pontos próximos da tela inteira.
// Tentamos as demais antes de desistir.
const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',   // costuma ser o mais rápido/estável
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const RAIO = 4000; // metros

// Categorias → tags OSM. Chaves iguais às usadas na UI (CATS_PROX).
export const CATEGORIAS = [
  { key: 'praia',      tags: [['natural', 'beach']] },
  { key: 'transporte', tags: [['highway', 'bus_stop'], ['railway', 'station'], ['station', 'subway'], ['railway', 'subway_entrance']] },
  { key: 'mercado',    tags: [['shop', 'supermarket']] },
  { key: 'farmacia',   tags: [['amenity', 'pharmacy']] },
  { key: 'saude',      tags: [['amenity', 'hospital'], ['amenity', 'clinic']] },
  { key: 'escola',     tags: [['amenity', 'school']] },
  { key: 'shopping',   tags: [['shop', 'mall']] },
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
  // timeout curto no Overpass (12s) para caber vários espelhos dentro do orçamento de 35s do cliente.
  const query = `[out:json][timeout:12];(${blocos});out center tags;`;
  // Tenta cada espelho em sequência; só lança se TODOS falharem (aí o chamador
  // responde com erro/retry, não com "vazio").
  let data = null, ultimoErro = 'sem resposta';
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        // 9s por espelho: se falhar, ainda dá tempo de tentar os próximos antes do abort de 35s do cliente.
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) { ultimoErro = `overpass ${res.status}`; continue; }
      data = await res.json();
      break;
    } catch (e) { ultimoErro = String(e?.message || e); }
  }
  if (!data) throw new Error(ultimoErro);
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
