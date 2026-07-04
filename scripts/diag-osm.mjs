#!/usr/bin/env node
/**
 * DIAGNÓSTICO (descartável): testa a acessibilidade dos endpoints do Overpass a
 * partir do runner do GitHub. Imprime status HTTP, tempo e início do corpo — para
 * saber se o problema é bloqueio de IP (403/429), formato ou lentidão.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const q = `[out:json][timeout:25];(node["amenity"="pharmacy"](around:1000,-23.5505,-46.6333););out center tags;`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function testar(ep, tent) {
  const t0 = Date.now();
  try {
    const r = await fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BidProBrasil/1.0 (contato: bidprobrasil)' },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(45000),
    });
    const ms = Date.now() - t0;
    const body = await r.text();
    let n = '?';
    try { n = (JSON.parse(body).elements || []).length; } catch {}
    console.log(`[${ep}] tent${tent} status=${r.status} ${ms}ms elements=${n}`);
    if (!r.ok) console.log(`   body: ${body.slice(0, 240).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`[${ep}] tent${tent} EXCEPTION ${e.name}: ${e.message} (${Date.now() - t0}ms)`);
  }
}

async function main() {
  // 3 tentativas por endpoint, espaçadas — para ver se é bloqueio imediato ou limite acumulado.
  for (let tent = 1; tent <= 3; tent++) {
    for (const ep of ENDPOINTS) { await testar(ep, tent); await sleep(1500); }
    console.log('---');
  }
}
main();
