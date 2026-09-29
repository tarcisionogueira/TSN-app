// COORDENADAS DO IMÓVEL RURAL A PARTIR DO TEXTO (29/09, passo 3 do plano de localização, 2ª parte).
//
// Matrícula de imóvel georreferenciado (SIGEF) descreve o perímetro por VÉRTICES com coordenada
// geográfica ("…21°12'34,56\"S e 47°45'12,34\"W…"), e o leiloeiro costuma copiar isso na descrição.
// É o ponto exato do imóvel, sem serviço externo nenhum.
//
// No Brasil a LATITUDE vai de 5°N a 33°S e a LONGITUDE de 34°W a 74°W: o próprio grau diz qual é
// qual (≤ 33 → latitude, ≥ 34 → longitude), mesmo quando o texto não rotula. Vários vértices → a
// MEDIANA (um vértice transcrito errado não arrasta o ponto). UTM fica de fora: sem o fuso, o par
// E/N não vira coordenada.
const RE_GMS = /(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:[.,]\d+)?)?\s*(?:"|''|”|″)?\s*([NSWOEL])?/gi;
const RE_DEC = /(-?\d{1,2}[.,]\d{4,})\s*[,;/ ]\s*(-?\d{2}[.,]\d{4,})/g;

const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function coordenadasDoTexto(texto) {
  const t = String(texto || '');
  const lats = [], lngs = [];
  for (const m of t.matchAll(RE_GMS)) {
    const g = Number(m[1]), mi = Number(m[2]), se = Number(String(m[3] || '0').replace(',', '.'));
    if (mi >= 60 || se >= 60) continue;
    const v = g + mi / 60 + se / 3600;
    const hem = (m[4] || '').toUpperCase();
    if (g <= 33) lats.push(hem === 'N' ? v : -v);
    else if (g >= 34 && g <= 74) lngs.push(-v);          // Brasil inteiro é oeste (W/O)
  }
  for (const m of t.matchAll(RE_DEC)) {
    const a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
    if (a >= -34 && a <= 5.5 && b >= -74 && b <= -34) { lats.push(a); lngs.push(b); }
  }
  if (!lats.length || !lngs.length) return null;
  return { lat: Math.round(mediana(lats) * 1e6) / 1e6, lng: Math.round(mediana(lngs) * 1e6) / 1e6, vertices: Math.min(lats.length, lngs.length) };
}

// Distância em km (haversine) — para conferir que o ponto cai perto do município do lote.
export function distanciaKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
