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

// O Overpass avisa erro de RUNTIME (query estourou o timeout, sem memória, sobrecarga) com
// **HTTP 200** e um campo `remark` no corpo, junto de `elements: []`. Checar `res.ok` não
// alcança isso: a resposta é um 200 legítimo com um vazio que NÃO significa "não há nada por
// perto", e sim "não consegui procurar". Sem esta checagem o vazio virava resposta válida,
// era gravado no banco e a tela dizia "Nenhum ponto de interesse mapeado nas proximidades"
// para um imóvel no meio de São Paulo. É a mesma família do `.json()` sem `.ok`, um nível
// mais fundo: aqui o erro vem DENTRO de um 200.
function falhaEmbutida(data) {
  const r = data && data.remark;
  return r ? String(r).slice(0, 200) : null;
}

/**
 * Consulta o Overpass e retorna o ponto mais próximo de cada categoria.
 * LANÇA quando não foi possível consultar — inclusive no caso "respondeu 200 mas vazio sem
 * corroboração". Vazio NÃO confirmado é falha, não resposta: quem chama re-tenta.
 */
export async function consultarProximidades(lat, lng) {
  const blocos = CATEGORIAS.flatMap(c => c.tags.map(([k, v]) => `nwr["${k}"="${v}"](around:${RAIO},${lat},${lng});`)).join('');
  // 12s era apertado para 11 cláusulas num raio de 4 km: o próprio Overpass estourava e
  // devolvia 200+remark. 20s reduz a causa na origem e ainda cabe no orçamento de 35s do
  // cliente, com folga para a corroboração curta abaixo.
  const query = `[out:json][timeout:20];(${blocos});out center tags;`;
  // Tenta os espelhos EM PARALELO: o PRIMEIRO que responder OK vence (Promise.any). Antes era
  // sequencial (até 5×9s = ~45s → estourava o abort de 35s do cliente e "não carregava"). Agora a
  // latência é a do espelho mais RÁPIDO; só lança se TODOS falharem (aí o chamador dá erro/retry).
  // ⚠️ Com `Promise.any`, a corrida premia o mais RÁPIDO — e um espelho que desiste na hora é o
  // mais rápido de todos. Por isso o `falhaEmbutida` precisa lançar DENTRO do `tentarEspelho`:
  // assim a desistência é derrota (o `any` segue para os outros) em vez de vitória.
  const tentarEspelho = (endpoint, timeoutMs = 22000) => fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(timeoutMs),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    const remark = falhaEmbutida(json);
    if (remark) throw new Error(`overpass 200 com remark: ${remark}`);
    return json;
  });
  let data = null;
  try {
    data = await Promise.any(OVERPASS_MIRRORS.map(ep => tentarEspelho(ep)));
  } catch (e) {
    const errs = (e && Array.isArray(e.errors)) ? e.errors.map(x => String(x?.message || x)).join('; ') : String(e?.message || e);
    throw new Error(errs || 'overpass indisponível');
  }

  // ZERO elementos é INCONCLUSIVO, não é resposta. Um raio de 4 km sem uma escola, um ponto de
  // ônibus ou uma farmácia existe (sítio, gleba rural), mas é raro — e é exatamente o que uma
  // consulta que falhou em silêncio também devolve. Antes de gravar "não há nada aqui" para
  // sempre, pedimos uma SEGUNDA OPINIÃO a outro espelho. Só o vazio corroborado é aceito;
  // vazio sem corroboração lança e o chamador re-tenta depois.
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    let confirmou = false;
    for (const ep of OVERPASS_MIRRORS.slice(1, 3)) {
      try {
        const segunda = await tentarEspelho(ep, 9000); // curto: é 2ª opinião, não pode estourar o orçamento
        if (Array.isArray(segunda.elements) && segunda.elements.length > 0) { data = segunda; confirmou = true; break; }
        confirmou = true; // respondeu limpo e também veio vazio → vazio de verdade
        break;
      } catch { /* espelho fora: tenta o próximo */ }
    }
    if (!confirmou) throw new Error('overpass devolveu vazio sem corroboração — inconclusivo');
  }

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
