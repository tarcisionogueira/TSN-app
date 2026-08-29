import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon — comprei.pgfn.gov.br (plataforma FEDERAL de leilões da PGFN). Descoberto via
 * hastaleilao (Flávio Costa), que é só um front-end filtrando vendedor=7509-2 nesta plataforma.
 * A URL /anuncio?ufs=..&page=..&size=..&sort=2 é uma QUERY REST → o app (SPA) chama um backend
 * JSON. Aqui procuramos esse backend: (1) framework/bundles da SPA; (2) endpoints candidatos nos
 * bundles; (3) tenta caminhos de API prováveis e dumpa o JSON com array de anúncio/imóvel.
 * NÃO grava. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }
const HOST = 'https://comprei.pgfn.gov.br';

async function bd(url, { json = false, timeoutMs = 40000 } = {}) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw', ...(json ? { headers: { Accept: 'application/json' } } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}
function pareceLote(o) {
  if (!o || typeof o !== 'object') return false;
  const k = Object.keys(o);
  return k.length >= 4 && k.some(x => /(valor|lance|avaliac|imovel|anuncio|lote|cidade|uf|municipio|endereco|matricula|descricao)/i.test(x));
}
function acharArray(node, prof = 0) {
  if (prof > 8 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { if (node.length && pareceLote(node[0])) return node; for (const v of node) { const r = acharArray(v, prof + 1); if (r) return r; } return null; }
  for (const v of Object.values(node)) { const r = acharArray(v, prof + 1); if (r) return r; }
  return null;
}

(async () => {
  // 1) SPA + bundles.
  const home = await bd(HOST + '/');
  console.log(`/ → ${home.status} len=${home.body.length}`);
  const fw = [];
  if (/ng-version|angular/i.test(home.body)) fw.push('Angular');
  if (/__NEXT_DATA__|_next/.test(home.body)) fw.push('Next');
  if (/type="module"|vite/i.test(home.body)) fw.push('Vite');
  if (/runtime\.[a-f0-9]+\.js|main\.[a-f0-9]+\.js|polyfills/.test(home.body)) fw.push('Angular-CLI');
  console.log('framework:', fw.join(',') || '?');
  const scripts = [...new Set([...home.body.matchAll(/(?:src|href)=["']([^"']+\.js)["']/gi)].map(m => m[1]))];
  const eps = new Set();
  for (const s of scripts.slice(0, 14)) {
    const u = s.startsWith('http') ? s : HOST + '/' + s.replace(/^\//, '');
    const b = await bd(u);
    for (const m of b.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]+\/[A-Za-z0-9/_\-.]*(?:api|anuncio|imovel|lote|leilao|edital|rest|v\d)[A-Za-z0-9/_\-.]*)["'`]/gi)) eps.add(m[1]);
    for (const m of b.body.matchAll(/["'`](\/(?:api|anuncio|imovel|lote|leilao|edital|rest|v\d)[A-Za-z0-9/_\-.]*)["'`]/gi)) eps.add(m[1]);
    for (const m of b.body.matchAll(/(?:baseUrl|apiUrl|API_URL|environment\.\w+)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi)) eps.add('[base] ' + m[1]);
  }
  console.log(`\nendpoints candidatos dos bundles (${eps.size}):`);
  [...eps].sort().slice(0, 50).forEach(e => console.log('   ' + e));

  // 2) Tenta caminhos de API prováveis (com filtro do Flávio Costa p/ trazer poucos e reais).
  const q = 'vendedor=7509-2&page=0&size=5&sort=2';
  const tentativas = [
    `${HOST}/anuncio?${q}`,
    `${HOST}/api/anuncio?${q}`, `${HOST}/api/anuncios?${q}`, `${HOST}/api/v1/anuncio?${q}`,
    `${HOST}/rest/anuncio?${q}`, `${HOST}/api/anuncio/buscar?${q}`, `${HOST}/api/leilao/anuncio?${q}`,
    `${HOST}/api/public/anuncio?${q}`, `${HOST}/anuncio/buscar?${q}`,
  ];
  console.log('\n— tentativas de API JSON —');
  for (const u of tentativas) {
    const r = await bd(u, { json: true });
    const isJson = /^\s*[[{]/.test(r.body.trim());
    let temLote = false, n = 0, amostra = '';
    if (isJson) { try { const j = JSON.parse(r.body); const a = acharArray(j); if (a) { temLote = true; n = a.length; amostra = JSON.stringify(a[0]).slice(0, 800); } else amostra = JSON.stringify(j).slice(0, 200); } catch { /* */ } }
    console.log(`  ${u.replace(HOST, '')} → ${r.status} ${isJson ? 'JSON' : 'HTML'} ${r.body.length}b${temLote ? ` · ✅ ${n} anúncios` : ''}`);
    if (temLote) { console.log(`     amostra: ${amostra}`); break; }
  }
})();
