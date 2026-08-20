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
  // APP ROUTER (recon v2, 20/08): a home é SSR de 216KB SEM __NEXT_DATA__ — Next.js App Router
  // embute os dados como chunks de FLIGHT em `self.__next_f.push([1,"..."])`, não em pageProps.
  // Estratégia: (1) dump dos HREFS da home p/ achar o padrão de URL de lote + a rota de listagem
  // REAL (as adivinhadas voltaram shell de 12KB); (2) contexto ao redor de "R$" (preço); (3)
  // tenta decodificar os chunks de flight e farejar arrays de lote.
  const home = await bdFetch(BASE + '/');
  console.log(`/ → HTTP ${home.status} len=${home.body.length} appRouter=${/__next_f|self\.__next/.test(home.body)}\n`);

  // 1) HREFS — agrupa por "forma" de caminho p/ revelar o padrão de lote e a listagem.
  const hrefs = [...new Set([...home.body.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]))]
    .filter(h => h.startsWith('/') && !h.startsWith('//') && !/\.(css|js|png|jpe?g|svg|ico|webp|woff2?)$/i.test(h));
  const loteLike = hrefs.filter(h => /(lote|imovel|imoveis|bem|leilao|leiloes)/i.test(h) || /\/\d{3,}(?:[/?#]|$)/.test(h));
  console.log(`HREFS totais ${hrefs.length}; parecidos com lote/listagem (${loteLike.length}):`);
  loteLike.slice(0, 40).forEach(h => console.log('   ' + h));

  // 2) PREÇO — quantos R$ e o contexto ao redor do 1º (confirma que a home traz lotes).
  const reais = [...home.body.matchAll(/R\$\s?[\d.]+,\d{2}/g)];
  console.log(`\nR$ na home: ${reais.length}`);
  const iR = home.body.search(/R\$\s?[\d.]+,\d{2}/);
  if (iR >= 0) console.log('   contexto 1º R$:', home.body.slice(Math.max(0, iR - 160), iR + 40).replace(/\s+/g, ' '));

  // 3) FLIGHT — decodifica os chunks self.__next_f.push([1,"...json..."]) e fareja arrays de lote.
  console.log('\n— flight chunks (App Router) —');
  let achou = 0;
  for (const m of home.body.matchAll(/self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\]\)/g)) {
    let s; try { s = JSON.parse(`"${m[1]}"`); } catch { continue; }
    // Dentro do chunk pode haver JSON embutido; procura objetos com cara de lote.
    if (!/(valor|lance|avaliac|imovel|lote|cidade|slug|endereco|praca|matricula)/i.test(s)) continue;
    for (const jm of s.matchAll(/\{[^{}]{40,900}\}/g)) {
      try {
        const o = JSON.parse(jm[0]);
        const keys = Object.keys(o);
        if (keys.some(k => /(valor|lance|avaliac|slug|cidade|titulo|endereco|imovel|lote)/i.test(k)) && keys.length >= 4) {
          console.log(`   objeto-lote (${keys.length} campos):`, JSON.stringify(o).slice(0, 700));
          if (++achou >= 3) break;
        }
      } catch { /* não é JSON puro */ }
    }
    if (achou >= 3) break;
  }
  if (!achou) console.log('   (nenhum objeto-lote isolável nos chunks; ver hrefs/preço acima p/ decidir SSR-HTML vs XHR)');

  // 4) bundles: endpoints de API (App Router pode ter route handlers /api/… ou backend externo).
  const scripts = [...new Set([...home.body.matchAll(/src=["']([^"']*\/_next\/static\/[^"']+\.js)["']/gi)].map(m => m[1]))];
  const eps = new Set();
  for (const s of scripts.slice(0, 10)) {
    const u = s.startsWith('http') ? s : BASE + s;
    const b = await bdFetch(u);
    for (const mm of b.body.matchAll(/["'`](https?:\/\/[a-z0-9.-]*(?:api|back|admin|painel)[a-z0-9.-]*\/[A-Za-z0-9/_\-{}.:?=&]*)["'`]/gi)) eps.add(mm[1]);
    for (const mm of b.body.matchAll(/["'`](\/(?:api|imoveis?|leiloes?|lotes?|busca|filtro)[A-Za-z0-9/_\-{}.:?=&]*)["'`]/gi)) eps.add(mm[1]);
  }
  console.log(`\nendpoints candidatos (${eps.size}):`);
  [...eps].sort().slice(0, 40).forEach(e => console.log('   ' + e));
})();
