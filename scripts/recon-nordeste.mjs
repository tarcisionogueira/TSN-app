/**
 * Recon RUNTIME — nordesteleiloes (Next.js SPA). Backlog: ~115 imóveis, precisa recon runtime.
 * Next.js embute o estado inicial em <script id="__NEXT_DATA__">…</script> (JSON) e serve dados
 * por /_next/data/<buildId>/… ou /api/…. Aqui: (1) baixa a home + rotas prováveis de imóveis via
 * Bright Data; (2) extrai __NEXT_DATA__ (buildId + pageProps + chaves que parecem lote); (3) lista
 * endpoints candidatos dos bundles. NÃO grava nada. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = process.env.NORDESTE_BASE || 'https://www.nordesteleiloes.com.br';

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  try {
    const r = await fetch('https://api.brightdata.com/request', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

function nextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
// Acha, recursivamente, chaves/arrays que parecem lote de imóvel (limite de profundidade).
function farejarLotes(obj, prof = 0, achados = { arrays: [], amostra: null }) {
  if (prof > 6 || !obj || typeof obj !== 'object') return achados;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      const keys = Object.keys(v[0]);
      if (keys.some(x => /(lote|imovel|bem|valor|lance|avaliac|cidade|uf|slug|titulo|endereco)/i.test(x))) {
        achados.arrays.push({ chave: k, n: v.length, campos: keys.slice(0, 20) });
        if (!achados.amostra) achados.amostra = v[0];
      }
    } else if (v && typeof v === 'object') farejarLotes(v, prof + 1, achados);
  }
  return achados;
}

(async () => {
  console.log(`Recon Nordeste (Next.js) — ${BASE}\n`);
  const rotas = ['/', '/imoveis', '/leiloes/imoveis', '/busca?categoria=imoveis', '/categoria/imoveis', '/leiloes'];
  let buildId = null;
  for (const rota of rotas) {
    const r = await bdFetch(BASE + rota);
    const nd = nextData(r.body);
    const isNext = /__NEXT_DATA__|\/_next\//.test(r.body);
    console.log(`${rota} → HTTP ${r.status} len=${r.body.length} next=${isNext} nextData=${!!nd}`);
    if (nd) {
      buildId = buildId || nd.buildId;
      const props = nd.props?.pageProps || {};
      const far = farejarLotes(props);
      if (far.arrays.length) {
        console.log(`   pageProps arrays de lote:`, JSON.stringify(far.arrays));
        console.log(`   amostra de 1 lote:`, JSON.stringify(far.amostra).slice(0, 900));
      } else {
        console.log(`   pageProps chaves: ${Object.keys(props).slice(0, 15).join(', ')}`);
      }
    }
  }
  console.log(`\nbuildId: ${buildId || '(não achado)'}`);

  // Endpoints /api/ e /_next/data nos bundles.
  const home = await bdFetch(BASE + '/');
  const scripts = [...new Set([...home.body.matchAll(/src=["']([^"']*\/_next\/static\/[^"']+\.js)["']/gi)].map(m => m[1]))];
  console.log(`\nbundles Next: ${scripts.length}`);
  const eps = new Set();
  for (const s of scripts.slice(0, 8)) {
    const u = s.startsWith('http') ? s : BASE + s;
    const b = await bdFetch(u);
    for (const m of b.body.matchAll(/["'`](\/(?:api|_next\/data|imoveis?|leiloes?|lotes?|busca|filtro)[A-Za-z0-9/_\-{}.:?=&]*)["'`]/gi)) eps.add(m[1]);
    for (const m of b.body.matchAll(/(?:fetch|axios\.(?:get|post))\s*\(\s*["'`]([^"'`]+)["'`]/gi)) if (/^[/h]/.test(m[1])) eps.add(m[1]);
  }
  console.log(`endpoints candidatos (${eps.size}):`);
  [...eps].sort().slice(0, 40).forEach(e => console.log('   ' + e));
  if (buildId) console.log(`\nDica: dados da página via https://.../_next/data/${buildId}/imoveis.json (ou o slug real).`);
})();
