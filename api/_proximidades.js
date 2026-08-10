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
 * Consulta o Overpass e devolve `{ pontos, vazio }`.
 *   - `vazio: false` → `pontos` tem o mais próximo de cada categoria encontrada.
 *   - `vazio: true`  → um espelho SAUDÁVEL respondeu com zero elementos. É um indício de vazio,
 *                      NÃO um veredito: quem chama precisa de várias observações antes de gravar
 *                      "não há nada aqui" (ver `proximidades_vazios` no cron).
 *   - LANÇA           → não foi possível consultar (todos os espelhos fora/limitados).
 *
 * ─── POR QUE ESTE DESENHO (correção da correção, 10/08, mesmo dia) ─────────────────────────
 * A 1ª tentativa de corrigir o "vazio falso" fez duas coisas erradas, e as duas apareceram em
 * 3 horas de produção:
 *
 * 1. CORROBORAÇÃO INSTANTÂNEA NÃO CORROBORA NADA. Perguntar a um 2º espelho no MESMO instante,
 *    sob a MESMA condição de carga, não é uma segunda observação — é a mesma observação duas
 *    vezes. Resultado medido: 247 de 248 imóveis processados saíram "vazio confirmado",
 *    incluindo 11 em São Paulo capital e 7 no Rio, onde 4 km sempre têm escola e farmácia.
 *    Só o TEMPO separa "a região não tem POI" de "os espelhos estavam sobrecarregados agora":
 *    a corroboração real é temporal, feita pelo chamador ao longo de execuções diferentes.
 *
 * 2. O PARALELO MULTIPLICAVA A CAUSA POR 5. `Promise.any` sobre os 5 espelhos dispara 5
 *    requisições por imóvel; com lote de 40 a cada 15 min, dava ~800 req/h contra instâncias
 *    PÚBLICAS que limitam por IP. Ou seja: a otimização de latência estava PRODUZINDO o
 *    rate-limit que gerava os vazios. Sequencial com rodízio faz 1 requisição por imóvel no
 *    caso bom — 5× menos carga — e ainda distribui entre os espelhos.
 */
export async function consultarProximidades(lat, lng, { rodizio = 0 } = {}) {
  const blocos = CATEGORIAS.flatMap(c => c.tags.map(([k, v]) => `nwr["${k}"="${v}"](around:${RAIO},${lat},${lng});`)).join('');
  const query = `[out:json][timeout:20];(${blocos});out center tags;`;

  const tentarEspelho = async (endpoint, timeoutMs) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 429/504 e afins: espelho limitado ou fora. NÃO é resposta.
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    // O Overpass avisa erro de RUNTIME com HTTP 200 + `remark`. Checar `.ok` não alcança.
    const remark = falhaEmbutida(json);
    if (remark) throw new Error(`overpass 200 com remark: ${remark}`);
    return json;
  };

  // SEQUENCIAL com rodízio: começa por um espelho diferente a cada chamada, para espalhar a
  // carga em vez de concentrar tudo no primeiro da lista. Para no PRIMEIRO que responder limpo.
  const ordem = OVERPASS_MIRRORS.map((_, i) => OVERPASS_MIRRORS[(i + rodizio) % OVERPASS_MIRRORS.length]);
  const erros = [];
  for (const ep of ordem) {
    try {
      const json = await tentarEspelho(ep, 12000);
      const elementos = Array.isArray(json.elements) ? json.elements : [];
      // Zero elementos de um espelho SAUDÁVEL: devolve como indício, não como veredito, e para
      // por aqui — insistir nos outros espelhos só multiplicaria a carga sem trazer certeza.
      if (!elementos.length) return { pontos: {}, vazio: true };

      const melhores = {};
      for (const el of elementos) {
        const plat = el.lat ?? el.center?.lat, plng = el.lon ?? el.center?.lon;
        if (plat == null || plng == null) continue;
        const cat = classifica(el.tags || {});
        if (!cat) continue;
        const dist = haversine(lat, lng, plat, plng);
        if (!melhores[cat] || dist < melhores[cat].dist_m) {
          melhores[cat] = { nome: el.tags?.name || null, dist_m: dist, lat: plat, lng: plng };
        }
      }
      // Veio elemento mas nenhum casou com as CATEGORIAS: é vazio de verdade para a nossa
      // finalidade — e a resposta prova que o espelho estava saudável. Ainda assim entra como
      // indício, pela mesma razão do caso acima.
      return { pontos: melhores, vazio: Object.keys(melhores).length === 0 };
    } catch (e) {
      erros.push(String(e?.message || e));
    }
  }
  throw new Error(`overpass indisponível: ${erros.join('; ')}`);
}
