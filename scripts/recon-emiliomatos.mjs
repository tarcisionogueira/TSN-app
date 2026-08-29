import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon RUNTIME (estático) — emiliomatosleiloes.com.br
 * ====================================================
 * O site é SPA Laravel+Vite atrás de Cloudflare: a home só tem o shell e os bundles
 * /build/assets/*.js; as chamadas de API vivem DENTRO do JS. Não dá para abrir navegador
 * contra o Cloudflare daqui, então baixamos os bundles via Bright Data e EXTRAÍMOS os
 * endpoints (fetch/axios/urls) — o substituto prático do grampo fetch/XHR do playbook.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = 'https://emiliomatosleiloes.com.br';
const MAX_BUNDLES = 12;

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  const r = await fetchUnlockerContado({
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, body: await r.text().catch(() => '') };
}

function abs(u) {
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return BASE + (u.startsWith('/') ? u : '/' + u);
}

// Extrai candidatos a endpoint de API do corpo de um bundle JS.
function extrairEndpoints(js) {
  const achados = new Set();
  // strings que parecem rota de API (/api/..., /core/api/..., /lotes..., get-lotes, etc.)
  const reStr = /["'`](\/(?:api|core|v1|v2|v3|lotes?|leiloes?|leilao|busca|search|imoveis?|filtro)[A-Za-z0-9/_\-{}.:?=&]*)["'`]/gi;
  let m;
  while ((m = reStr.exec(js))) achados.add(m[1]);
  // axios/fetch com caminho literal
  const reCall = /(?:axios\.(?:get|post|put)|fetch)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reCall.exec(js))) if (/^[\/h]/.test(m[1])) achados.add(m[1]);
  // baseURL / apiUrl / VITE_ env inlined
  const reBase = /(?:baseURL|apiUrl|api_url|API_URL|VITE_[A-Z_]*URL)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reBase.exec(js))) achados.add('[base] ' + m[1]);
  // método/rota estilo Laravel (route('...'))
  const reRoute = /route\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = reRoute.exec(js))) achados.add('[route] ' + m[1]);
  return [...achados];
}

(async () => {
  console.log(`Recon emiliomatos — baixando shell + bundles via Bright Data.\n`);
  const home = await bdFetch(BASE + '/');
  console.log(`HOME → HTTP ${home.status}  len=${home.body.length}`);
  if (/just a moment|cf-challenge|Enable JavaScript to run/i.test(home.body)) {
    console.log('⚠️ Corpo parece desafio Cloudflare — Bright Data pode não ter resolvido o JS challenge.');
  }
  // bundles referenciados no HTML
  const assets = [...new Set(
    [...home.body.matchAll(/(?:src|href)=["']([^"']*\/build\/assets\/[^"']+\.js)["']/gi)].map(x => x[1])
      .concat([...home.body.matchAll(/["']([^"']*\/build\/assets\/[^"']+\.js)["']/gi)].map(x => x[1]))
  )];
  console.log(`Bundles encontrados no HTML: ${assets.length}`);
  assets.slice(0, 20).forEach(a => console.log('   ' + a));

  // endpoints do próprio HTML (às vezes há window.__DATA__ ou meta)
  const doHtml = extrairEndpoints(home.body);
  if (doHtml.length) { console.log('\n[HTML] candidatos:'); doHtml.forEach(e => console.log('   ' + e)); }

  const todos = new Map(); // endpoint -> [bundles]
  let baixados = 0;
  for (const a of assets.slice(0, MAX_BUNDLES)) {
    const url = abs(a);
    const b = await bdFetch(url);
    baixados++;
    const eps = extrairEndpoints(b.body);
    console.log(`\n── ${a}  (HTTP ${b.status}, ${b.body.length} bytes) → ${eps.length} candidato(s)`);
    for (const e of eps) {
      if (!todos.has(e)) todos.set(e, []);
      todos.get(e).push(a.split('/').pop());
      console.log('   ' + e);
    }
  }

  console.log(`\n═══════════ CONSOLIDADO (${baixados} bundles, ${todos.size} endpoints únicos) ═══════════`);
  [...todos.entries()].sort().forEach(([e, bs]) => console.log(`   ${e}   ⟵ ${[...new Set(bs)].join(',')}`));
  console.log('\nDica: procure a rota de LISTAGEM (lotes/imóveis/busca) com paginação. É o alvo do scraper.');
})();
