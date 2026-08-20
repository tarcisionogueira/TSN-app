/**
 * Recon combinado (20/08): (A) alfaleiloes — extrai o BLOB JSON embutido e disseca 1 lote p/
 * desenhar o parser; (B) leilaobrasil — conta lotes na home SSR e sonda paginação p/ ESTIMAR o
 * custo BD por rodada (por-página vs por-lote). NÃO grava. Env: BRIGHTDATA_API_TOKEN, ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
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
function blobsJson(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* não puro */ }
  }
  // Next/Vite às vezes usam __NEXT_DATA__ / window.__X__ = {...}
  const w = html.match(/window\.__[A-Z_]+__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (w) { try { out.push(JSON.parse(w[1])); } catch { /* */ } }
  return out;
}
function farejar(obj, prof = 0, achados = { arrays: [], amostra: null }) {
  if (prof > 7 || !obj || typeof obj !== 'object') return achados;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      const keys = Object.keys(v[0]);
      if (keys.some(x => /(lote|imovel|bem|valor|lance|avaliac|cidade|uf|slug|titulo|endereco|praca)/i.test(x))) {
        achados.arrays.push({ chave: k, n: v.length, campos: keys.slice(0, 24) });
        if (!achados.amostra) achados.amostra = v[0];
      }
    } else if (v && typeof v === 'object') farejar(v, prof + 1, achados);
  }
  return achados;
}

(async () => {
  // ─── A) ALFALEILOES ───
  console.log('╔═══════════ ALFALEILOES ═══════════╗');
  const aHome = await bd('https://www.alfaleiloes.com.br/');
  console.log(`home ${aHome.status} len=${aHome.body.length}`);
  const aLotes = [...new Set([...aHome.body.matchAll(/\/lote\/(\d+)\/([a-z0-9-]+)/gi)].map(m => m[0]))];
  console.log(`lotes na home: ${aLotes.length}. Amostra:`, JSON.stringify(aLotes.slice(0, 5)));
  for (const b of blobsJson(aHome.body)) {
    const f = farejar(b);
    if (f.arrays.length) {
      console.log('  BLOB → arrays de lote:', JSON.stringify(f.arrays));
      console.log('  amostra de 1 lote:', JSON.stringify(f.amostra).slice(0, 1100));
    }
  }
  if (aLotes[0]) {
    const d = await bd('https://www.alfaleiloes.com.br' + aLotes[0]);
    console.log(`\ndetalhe ${aLotes[0]} → ${d.status} len=${d.body.length}`);
    const og = (p) => (d.body.match(new RegExp(`property=["']og:${p}["'][^>]*content=["']([^"']+)["']`, 'i')) || [])[1] || '';
    console.log('  og:title:', og('title'), '| og:image:', og('image') ? 'sim' : 'não');
    for (const b of blobsJson(d.body)) {
      const f = farejar(b);
      if (f.amostra) { console.log('  detalhe BLOB amostra:', JSON.stringify(f.amostra).slice(0, 1100)); break; }
    }
  }

  // ─── B) LEILAOBRASIL (custo) ───
  console.log('\n╔═══════════ LEILAOBRASIL (custo BD) ═══════════╗');
  const lHome = await bd('https://www.leilaobrasil.com.br/');
  const lLotes = [...new Set([...lHome.body.matchAll(/\/eventos\/leilao\/[a-z0-9-]+\/lote\/(\d+)/gi)].map(m => m[0]))];
  const lReais = (lHome.body.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
  console.log(`home ${lHome.status} len=${lHome.body.length} · R$=${lReais} · lotes-url únicos na home: ${lLotes.length}`);
  console.log('  amostra lotes:', JSON.stringify(lLotes.slice(0, 4)));
  // paginação: procura ?page= / /pagina/ / rel=next e sonda página 2.
  const pag = [...new Set([...lHome.body.matchAll(/href=["']([^"']*(?:[?&]page=|\/pagina\/|[?&]p=)\d+[^"']*)["']/gi)].map(m => m[1]))].slice(0, 6);
  console.log('  sinais de paginação:', JSON.stringify(pag));
  // A home já traz o dado do lote? Contexto ao redor do 1º lote-url.
  const iL = lHome.body.search(/\/eventos\/leilao\/[a-z0-9-]+\/lote\/\d+/i);
  if (iL >= 0) {
    const trecho = lHome.body.slice(iL - 40, iL + 700).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('  contexto do 1º lote na home (tem preço/cidade?):', trecho.slice(0, 400));
  }
  console.log('\n>>> CUSTO: se a home/catálogo já traz preço+cidade por lote, é ~N páginas de BD por rodada.');
  console.log('>>> Se cada lote exige detalhe, é ~total_lotes fetches de BD por rodada (caro).');
})();
