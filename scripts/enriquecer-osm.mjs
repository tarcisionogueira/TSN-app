#!/usr/bin/env node
/**
 * Índice de Localização (OSM) — job em lote no runner do GitHub (grátis).
 *
 * REGRA (validada com o dono): para cada imóvel com geocoding de ENDEREÇO
 * (preciso), consulta o Overpass ao redor da COORDENADA DO PRÓPRIO IMÓVEL e
 * calcula um score 0–10 por *distance-decay*: quanto MAIS PERTO, MAIOR a nota;
 * itens NEGATIVOS (presídio/aterro/usina) fazem o OPOSTO — quanto mais perto,
 * mais penalizam. Não calcula em bairro/cidade (coordenada aproximada → erro).
 *
 * Grava pontos_proximos (POI mais próximo por categoria, com dist_m) e
 * score_localizacao. Categorias iguais às da tela: transporte, mercado, farmacia,
 * saude, escola, shopping.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: OSM_LIMITE, OSM_PAUSA_MS.
 */
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.OSM_LIMITE || '3000', 10);
const PAUSA_MS = parseInt(process.env.OSM_PAUSA_MS || '1200', 10); // gentil com o Overpass
const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEADLINE = Date.now() + 70 * 60 * 1000;

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
  return -10 * (raio - dist) / raio; // colado = -10, decai a 0 no raio
}

async function overpass(lat, lng) {
  const q = `[out:json][timeout:25];(
    nwr["railway"~"station|subway_entrance|tram_stop"](around:1500,${lat},${lng});
    node["highway"="bus_stop"](around:1500,${lat},${lng});
    node["public_transport"="station"](around:1500,${lat},${lng});
    nwr["shop"~"supermarket|convenience|greengrocer"](around:1500,${lat},${lng});
    nwr["amenity"="pharmacy"](around:2000,${lat},${lng});
    nwr["shop"="chemist"](around:2000,${lat},${lng});
    nwr["amenity"~"hospital|clinic|doctors"](around:3000,${lat},${lng});
    nwr["amenity"~"school|kindergarten|college"](around:2000,${lat},${lng});
    nwr["shop"="mall"](around:4000,${lat},${lng});
    nwr["amenity"="prison"](around:1200,${lat},${lng});
    nwr["landuse"="landfill"](around:1200,${lat},${lng});
    nwr["power"="plant"](around:1200,${lat},${lng});
  );out center tags;`;
  let lastErr = 'sem tentativa';
  for (const ep of ENDPOINTS) {
    for (let tent = 0; tent < 2; tent++) {
      try {
        const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(40000) });
        if (r.status === 429 || r.status === 504) { lastErr = `${ep} ${r.status}`; await sleep(4000); continue; }
        if (!r.ok) { lastErr = `${ep} HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`; break; }
        return (await r.json()).elements || [];
      } catch (e) { lastErr = `${ep} ${e.name}: ${e.message}`; await sleep(1000); }
    }
  }
  throw new Error(lastErr);
}

function avaliar(lat, lng, elements) {
  const nearest = {};
  const registrar = (cat, el) => {
    const elat = el.lat ?? el.center?.lat, elng = el.lon ?? el.center?.lon;
    if (elat == null || elng == null) return;
    const dist_m = Math.round(haversine(lat, lng, elat, elng));
    if (!nearest[cat] || dist_m < nearest[cat].dist_m) nearest[cat] = { lat: elat, lng: elng, nome: el.tags?.name || null, dist_m };
  };
  for (const el of elements) {
    const t = el.tags || {};
    for (const [cat, cfg] of Object.entries(POS)) if (cfg.match(t)) { registrar(cat, el); break; }
    if (NEG.match(t)) registrar('negativo', el);
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
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('id, latitude, longitude')
      .eq('ativo', true).eq('geocod_nivel', 'endereco')
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
  const cands = await buscarCandidatos();
  if (!cands.length) { console.log('OSM: sem candidatos (endereço).'); return; }
  console.log(`OSM localização: ${cands.length} candidatos (endereço) · limite ${LIMITE} · pausa ${PAUSA_MS}ms`);
  let ok = 0, falha = 0, feitos = 0;
  for (const im of cands) {
    if (Date.now() > DEADLINE) { console.log('OSM: teto de tempo atingido'); break; }
    const lat = Number(im.latitude), lng = Number(im.longitude);
    const patch = { proximidades_em: new Date().toISOString() };
    try {
      const els = await overpass(lat, lng);
      const { nearest, score } = avaliar(lat, lng, els);
      patch.pontos_proximos = nearest;
      patch.score_localizacao = score;
      ok++;
    } catch (e) { falha++; if (falha <= 5) console.error(`  falha ${im.id}: ${e.message}`); }
    feitos++;
    await supabase.from('imoveis_leilao').update(patch).eq('id', im.id).then(() => {}, () => {});
    if (feitos % 50 === 0) console.log(`  ${feitos}/${cands.length} · ok ${ok} · falha ${falha}`);
    await new Promise(r => setTimeout(r, PAUSA_MS));
  }
  console.log(`FIM OSM localização: ok ${ok} · falha ${falha} · processados ${feitos}`);
}

main().catch(e => { console.error(e); process.exit(1); });
