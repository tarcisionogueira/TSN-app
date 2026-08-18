#!/usr/bin/env node
/**
 * Índice de Localização (OSM) — job em lote no runner do GitHub (grátis).
 *
 * REGRA (validada com o dono): para cada imóvel com geocoding de ENDEREÇO
 * (preciso), calcula um score 0–10 por *distance-decay* ao redor da COORDENADA
 * DO PRÓPRIO IMÓVEL: quanto MAIS PERTO, MAIOR a nota; itens NEGATIVOS
 * (presídio/aterro/usina) fazem o OPOSTO. Não calcula em bairro/cidade.
 *
 * FONTE DOS POIs: extrato local do OpenStreetMap (Geofabrik Brasil) já filtrado
 * pelo osmium para um GeoJSONSeq com só as categorias de interesse. Assim NÃO
 * dependemos do Overpass público (que bloqueia/limita o IP do runner). O workflow
 * baixa o PBF, roda o osmium e chama este script apontando OSM_POIS_FILE.
 *
 * Grava pontos_proximos (POI mais próximo por categoria, com dist_m) e
 * score_localizacao. Categorias iguais às da tela.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, OSM_POIS_FILE. Opcional: OSM_LIMITE.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const POIS_FILE = process.env.OSM_POIS_FILE || 'pois.geojsonl';
const LIMITE = parseInt(process.env.OSM_LIMITE || '100000', 10);

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

// Rubric: peso, ideal (nota 10 até aqui), max (nota 0 a partir daqui) + o "match" OSM.
const POS = {
  transporte: { peso: 3, ideal: 300, max: 1500, match: t => t.railway === 'station' || t.railway === 'subway_entrance' || t.railway === 'tram_stop' || t.station === 'subway' || t.highway === 'bus_stop' || t.public_transport === 'station' },
  mercado:    { peso: 3, ideal: 300, max: 1500, match: t => t.shop === 'supermarket' || t.shop === 'convenience' || t.shop === 'greengrocer' },
  farmacia:   { peso: 2, ideal: 400, max: 2000, match: t => t.amenity === 'pharmacy' || t.shop === 'chemist' },
  saude:      { peso: 2, ideal: 700, max: 3000, match: t => t.amenity === 'hospital' || t.amenity === 'clinic' || t.amenity === 'doctors' || !!t.healthcare },
  escola:     { peso: 2, ideal: 400, max: 2000, match: t => t.amenity === 'school' || t.amenity === 'kindergarten' || t.amenity === 'college' },
  shopping:   { peso: 1, ideal: 800, max: 4000, match: t => t.shop === 'mall' || t.amenity === 'marketplace' },
};
const NEG = { raio: 1200, match: t => t.amenity === 'prison' || t.landuse === 'landfill' || t.power === 'plant' || t.man_made === 'wastewater_plant' };
const CATS = Object.keys(POS);
const MAX_BUSCA_M = 4000; // maior raio de interesse (shopping)

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function scorePos(dist, ideal, max) {
  if (dist == null) return 0;
  if (dist <= ideal) return 10;
  if (dist >= max) return 0;
  return 10 * (max - dist) / (max - ideal);
}
function penalNeg(dist, raio) {
  if (dist == null || dist >= raio) return 0;
  return -10 * (raio - dist) / raio;
}

// Ponto representativo de uma geometria GeoJSON (centroide simples p/ área/linha).
function repPonto(geom) {
  if (!geom) return null;
  const g = geom.coordinates;
  if (geom.type === 'Point') return [g[1], g[0]];
  const anel = geom.type === 'Polygon' ? g[0]
    : geom.type === 'MultiPolygon' ? g[0]?.[0]
    : geom.type === 'LineString' ? g
    : geom.type === 'MultiLineString' ? g[0] : null;
  if (!anel || !anel.length) return null;
  let sx = 0, sy = 0;
  for (const p of anel) { sx += p[0]; sy += p[1]; }
  return [sy / anel.length, sx / anel.length];
}

// Índice espacial em grade (~2 km por célula) para achar POIs perto rapidamente.
const CELL = 0.02;
const chave = (la, ln) => `${Math.round(la / CELL)}_${Math.round(ln / CELL)}`;
const grade = new Map();

function categoria(t) {
  for (const cat of CATS) if (POS[cat].match(t)) return cat;
  if (NEG.match(t)) return 'negativo';
  return null;
}

// PISO MÍNIMO DE POIs (13/08). `existsSync` prova que o arquivo EXISTE, não que ele veio
// inteiro. Um PBF baixado pela metade ou um osmium interrompido produzem um GeoJSONSeq curto,
// válido e pobre — e aí `avaliar()` devolve `{}` para TODO imóvel do país. Sem este piso, um
// download truncado zeraria as proximidades do acervo inteiro num único run, cada linha
// carimbada como resposta boa. Abortar é a única saída correta: "não consegui carregar" não
// pode ser processado como "não há nada no Brasil".
const POIS_MINIMO = Number(process.env.OSM_POIS_MINIMO || 50000);

async function carregarPois() {
  if (!fs.existsSync(POIS_FILE)) { console.error(`POIs não encontrado: ${POIS_FILE}`); process.exit(1); }
  const rl = readline.createInterface({ input: fs.createReadStream(POIS_FILE), crlfDelay: Infinity });
  let n = 0, usados = 0;
  for await (let line of rl) {
    line = line.replace(/^\x1e/, '').trim(); // geojsonseq pode prefixar RS (0x1e)
    if (!line) continue;
    n++;
    let f; try { f = JSON.parse(line); } catch { continue; }
    const cat = categoria(f.properties || {});
    if (!cat) continue;
    const pt = repPonto(f.geometry);
    if (!pt) continue;
    const [la, ln] = pt;
    const k = chave(la, ln);
    let arr = grade.get(k); if (!arr) { arr = []; grade.set(k, arr); }
    arr.push({ lat: la, lng: ln, cat, nome: f.properties?.name || null });
    usados++;
  }
  console.log(`POIs lidos: ${n} · usados (categorizados): ${usados} · células ${grade.size}`);
  if (usados < POIS_MINIMO) {
    console.error(`❌ Extrato OSM pobre demais: ${usados} POIs categorizados < piso ${POIS_MINIMO}. `
      + 'Provável download/osmium truncado — abortando ANTES de gravar, para não carimbar o acervo como vazio.');
    process.exit(1);
  }
}

function avaliar(lat, lng) {
  const R = 2; // ±2 células (~5 km) cobre o maior raio de interesse (4 km)
  const clat = Math.round(lat / CELL), clng = Math.round(lng / CELL);
  const nearest = {};
  for (let dla = -R; dla <= R; dla++) for (let dln = -R; dln <= R; dln++) {
    const arr = grade.get(`${clat + dla}_${clng + dln}`);
    if (!arr) continue;
    for (const p of arr) {
      const dist_m = Math.round(haversine(lat, lng, p.lat, p.lng));
      if (dist_m > MAX_BUSCA_M + 500) continue;
      if (!nearest[p.cat] || dist_m < nearest[p.cat].dist_m) nearest[p.cat] = { lat: p.lat, lng: p.lng, nome: p.nome, dist_m };
    }
  }
  let somaPeso = 0, somaNota = 0;
  for (const [cat, cfg] of Object.entries(POS)) { somaNota += scorePos(nearest[cat]?.dist_m ?? null, cfg.ideal, cfg.max) * cfg.peso; somaPeso += cfg.peso; }
  let score = somaPeso ? somaNota / somaPeso : 0;
  score += penalNeg(nearest.negativo?.dist_m ?? null, NEG.raio);
  return { nearest, score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)) };
}

async function buscarCandidatos() {
  const PAG = 1000, out = [];
  while (out.length < LIMITE) {
    // ─── RUA E BAIRRO ENTRAM (17/08) ──────────────────────────────────────────────────────
    // Por nível de geocode, os vazios falsos do acervo eram: `endereco` ZERO (13.077 lotes,
    // servidos por ESTE job) × `cidade` 1.035 × `bairro` 272 × `rua` 110. Ou seja: onde este
    // job atendia não havia UM caso; o dano inteiro estava na população que ele recusava e que
    // sobrava para o Overpass público. O extrato Geofabrik cobre o Brasil inteiro e já é
    // baixado todo dia — restringi-lo a `endereco` deixava de fora justamente quem precisava.
    // `cidade` continua de fora, e de propósito: é o centroide do município (91 lotes na mesma
    // coordenada em SP), do qual não se mede distância de imóvel nenhum.
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('id, latitude, longitude, pontos_proximos, geocod_nivel')
      .eq('ativo', true).in('geocod_nivel', ['endereco', 'rua', 'bairro'])
      .not('latitude', 'is', null).neq('latitude', 0)
      .order('proximidades_em', { ascending: true, nullsFirst: true })
      .range(out.length, out.length + PAG - 1);
    if (error) { console.error('query erro:', error.message); break; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAG) break;
  }
  return out.slice(0, LIMITE);
}

async function main() {
  await carregarPois();
  const cands = await buscarCandidatos();
  if (!cands.length) { console.log('OSM: sem candidatos (endereço).'); return; }
  console.log(`OSM localização: ${cands.length} candidatos (endereço) · limite ${LIMITE}`);
  let ok = 0, vazios = 0, falhas = 0, feitos = 0;
  const CONC = 8; // gravação no Supabase em paralelo (cálculo é local e rápido)
  let idx = 0;
  async function worker() {
    while (idx < cands.length) {
      const im = cands[idx++];
      const lat = Number(im.latitude), lng = Number(im.longitude);
      const { nearest, score } = avaliar(lat, lng);
      const achou = Object.keys(nearest).length > 0;

      // ─── VAZIO NÃO É RESPOSTA (13/08) ──────────────────────────────────────────────
      // Este job gravava `pontos_proximos: nearest` mesmo com `nearest = {}`, carimbando
      // `proximidades_em`. Dois estragos, medidos no acervo:
      //
      // 1. Um vazio de UMA observação virava veredito. O cron do Overpass exige TRÊS
      //    observações em execuções diferentes antes de aceitar `{}` (ver
      //    `api/enriquecer-proximidades.js`) e o on-demand se recusa a gravar vazio — este
      //    job furava os dois. Sintoma: 293 lotes com `{}` e o contador de corroboração
      //    em ZERO, estado que o cron não consegue produzir.
      // 2. Pior: o carimbo diário de `proximidades_em` DESLIGAVA a auto-cura. A fila de
      //    revalidação do cron busca `proximidades_em < now() - 30 dias`, e 12.820 dos
      //    13.101 lotes com geocode preciso eram recarimbados a cada 48h — nenhum deles
      //    envelhecia o bastante para ser reconferido. O `{}` com validade de 30 dias era
      //    renovado todo dia, para sempre.
      //
      // Agora: sem POI encontrado, grava só o `score_localizacao` e NÃO toca em
      // `pontos_proximos` nem em `proximidades_em` — o lote segue para o cron corroborar.
      // O SCORE CONTINUA SÓ PARA `endereco` — a regra validada com o dono no topo deste arquivo
      // ("não calcula em bairro/cidade") não mudou. O que mudou é que ela deixou de arrastar
      // junto as PROXIMIDADES: nota de localização a partir de uma coordenada aproximada seria
      // enganosa, mas listar a escola mais próxima, rotulada como origem aproximada, é
      // informação honesta — e infinitamente melhor que o "nenhum ponto de interesse" que estes
      // lotes recebiam do Overpass. Duas perguntas diferentes, dois critérios diferentes.
      const patch = im.geocod_nivel === 'endereco' ? { score_localizacao: score } : {};
      if (achou) {
        // Preserva as categorias que ESTE job não sabe calcular. `praia` só existe no helper
        // do Overpass (`api/_proximidades.js`); sem esta mesclagem, os 411 lotes de praia
        // perdiam a categoria toda vez que o job os tocava.
        const soDoOverpass = Object.fromEntries(
          Object.entries(im.pontos_proximos || {}).filter(([k]) => !CATS.includes(k) && k !== 'negativo'));
        patch.pontos_proximos = { ...soDoOverpass, ...nearest };
        patch.proximidades_em = new Date().toISOString();
      }
      // Nada a gravar (rua/bairro sem POI: não tem score a escrever e não se toca no vazio) —
      // sai sem chamar o banco. Um `update({})` seria uma ida ao PostgREST sem efeito, e o
      // resultado dela entraria na contagem como se fosse trabalho feito.
      if (!Object.keys(patch).length) { vazios++; feitos++; continue; }
      const { error } = await supabase.from('imoveis_leilao').update(patch).eq('id', im.id);
      if (error) falhas++;
      else if (achou) ok++;
      else vazios++;
      feitos++;
      if (feitos % 500 === 0) console.log(`  ${feitos}/${cands.length} · com pontos ${ok} · sem POI ${vazios} · falhas ${falhas}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  // `vazios` separado de `ok` é o que distingue um run saudável de um extrato pobre: se ele
  // disparar, o problema é o arquivo de POIs, não o Brasil ter ficado sem escolas.
  console.log(`FIM OSM localização: ${ok} com pontos · ${vazios} sem POI (deixados p/ o cron) · ${falhas} falhas · ${feitos} processados`);
}

main().catch(e => { console.error(e); process.exit(1); });
