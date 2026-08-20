/**
 * Recon PRECISO do alfaleiloes (Passo 1 do motor: blob-json) — decide o data source ANTES de codar.
 * Dump do conteúdo CRU de cada <script type="…json">, dos `window.__X__=` e dos endpoints de API
 * nos bundles. Se o lote está num blob → engine blob-json; se só há ld+json de SEO + XHR → alfa é
 * caso do Passo 2 (dom). Não grava. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = 'https://www.alfaleiloes.com.br';
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bd(url, timeoutMs = 40000) {
  try {
    const r = await fetch('https://api.brightdata.com/request', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

(async () => {
  const home = await bd(BASE + '/');
  console.log(`home ${home.status} len=${home.body.length}\n`);

  // 1) Todos os <script type="…json"> — o alvo do engine blob-json.
  console.log('── <script type="…json"> (conteúdo cru) ──');
  let n = 0;
  for (const m of home.body.matchAll(/<script[^>]*type=["']application\/(ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    n++;
    const raw = m[2].trim();
    console.log(`\n#${n} (${m[1] ? 'ld+json' : 'json'}, ${raw.length} chars):`);
    console.log('  ' + raw.slice(0, 1400).replace(/\s+/g, ' '));
  }
  if (!n) console.log('  (nenhum <script json>)');

  // 2) window.__X__ = {...} (estado embutido tipo Vuex/Redux/Nuxt).
  console.log('\n── window.__…__ = (estado embutido) ──');
  const w = [...home.body.matchAll(/window\.(__[A-Z0-9_]+__|[a-zA-Z_]+State)\s*=\s*(\{[\s\S]{0,400})/g)];
  if (w.length) w.slice(0, 3).forEach(m => console.log(`  ${m[1]} = ${m[2].replace(/\s+/g, ' ').slice(0, 300)}…`));
  else console.log('  (nenhum window.__…__)');

  // 3) Lotes na home (slugs ricos: tipo/cidade/UF) — mesmo sem blob, o slug dá muita coisa.
  const lotes = [...new Set([...home.body.matchAll(/\/lote\/(\d+)\/([a-z0-9-]+)/gi)].map(m => m[0]))];
  console.log(`\n── ${lotes.length} lotes na home (slug tem tipo+cidade+UF) ──`);
  lotes.forEach(l => console.log('  ' + l));

  // 4) R$ com contexto no HTML cru — a home MOSTRA preço? (se sim, dá p/ ler da listagem)
  const reais = [...home.body.replace(/<[^>]+>/g, ' ').matchAll(/(.{0,30})R\$\s?([\d.]+,\d{2})/g)];
  console.log(`\n── R$ no HTML cru: ${reais.length} ──`);
  reais.slice(0, 6).forEach(m => console.log(`  …${m[1].replace(/\s+/g, ' ').trim()} → R$ ${m[2]}`));

  // 5) Endpoints de API/XHR nos bundles (se o dado vem de fetch, é caso do Passo 2/dom).
  console.log('\n── endpoints de API nos bundles ──');
  const scripts = [...new Set([...home.body.matchAll(/src=["']([^"']+\.js)["']/gi)].map(m => m[1]))].slice(0, 8);
  const eps = new Set();
  for (const s of scripts) {
    const u = s.startsWith('http') ? s : BASE + (s.startsWith('/') ? '' : '/') + s;
    const b = await bd(u);
    for (const mm of b.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]*(?:api|back|admin|painel)[a-z0-9.-]*\/[^"'`]{0,80})["'`]/gi)) eps.add(mm[1]);
    for (const mm of b.body.matchAll(/["'`](\/(?:api|lotes?|leiloes?|imoveis?|busca)[A-Za-z0-9/_\-{}.:?=&]{0,60})["'`]/gi)) eps.add(mm[1]);
  }
  if (eps.size) [...eps].sort().slice(0, 30).forEach(e => console.log('  ' + e));
  else console.log('  (nenhum endpoint óbvio — provável SSR/blob, não XHR)');
})();
