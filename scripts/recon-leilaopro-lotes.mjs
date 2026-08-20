/**
 * Recon PROFUNDO LeilãoPro Core (v3) — enumera lotes de imóvel na listagem e disseca 1 detalhe.
 * Padrão de detalhe descoberto: /leilao/<slug>/lote_id/<ID>. Env: BRIGHTDATA_API_TOKEN, ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = process.env.LEILAOPRO_BASE || 'https://www.leffaleiloes.com.br';

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

(async () => {
  const L = await bdFetch(BASE + '/leilao/lotes/imoveis');
  const html = L.body;
  console.log(`LISTAGEM imóveis → HTTP ${L.status} len=${html.length}`);

  // Lotes: /leilao/<slug>/lote_id/<ID>
  const lotes = [...new Set([...html.matchAll(/href=["'](\/leilao\/[^"']*?\/lote_id\/(\d+))["']/gi)].map(m => m[1]))];
  const ids = [...new Set([...html.matchAll(/\/lote_id\/(\d+)/g)].map(m => m[1]))];
  console.log(`\n[lotes de imóvel] ${lotes.length} link(s), ${ids.length} id(s) únicos: ${ids.join(',')}`);
  lotes.slice(0, 20).forEach(h => console.log('   ' + h));

  // Paginação? procura links de página na categoria.
  const pag = [...new Set([...html.matchAll(/lotes\/imoveis[^"']*?[?&](?:pagina|page)=(\d+)/gi)].map(m => m[1]))];
  console.log(`[paginação categoria] ${pag.length ? pag.join(',') : '(nenhuma — página única)'}`);

  if (!lotes.length) { console.log('Sem lotes — nada a dissecar.'); return; }

  // DETALHE do 1º lote real.
  const durl = BASE + lotes[0];
  const D = await bdFetch(durl);
  const b = D.body;
  console.log(`\n╔═══ DETALHE ${durl} → HTTP ${D.status} len=${b.length} ═══╗`);
  console.log('title:', (b.match(/<title[^>]*>([\s\S]{0,180}?)<\/title>/i) || [])[1]?.trim());
  console.log('h1:', (b.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  console.log('og:title:', (b.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || [])[1]);
  console.log('og:image:', (b.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]);
  console.log('og:description:', (b.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || [])[1]?.slice(0, 200));

  // valores com rótulo: capturo trechos "…Lance…R$…", "…Avaliação…R$…", "1ª Praça…R$…"
  const dtxt = b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const rotulos = ['lance inicial', 'lance atual', 'lance m[íi]nimo', 'avalia[çc][ãa]o', '1[ªa]\\s*pra[çc]a', '2[ªa]\\s*pra[çc]a', 'valor', 'incremento'];
  console.log('\n[valores rotulados]');
  for (const r of rotulos) {
    const m = dtxt.match(new RegExp(`(${r})[^R]{0,40}(R\\$\\s?[\\d.,]+)`, 'i'));
    if (m) console.log(`   ${m[1]} → ${m[2]}`);
  }
  console.log('\ntodos R$ (12):', (dtxt.match(/R\$\s?[\d.,]+/g) || []).slice(0, 12).join(' | '));
  console.log('cidade/UF no texto:', (dtxt.match(/[A-Za-zÀ-ú .]{3,45}\/[A-Z]{2}\b/g) || []).slice(0, 6).join(' | '));
  console.log('m²:', (dtxt.match(/[\d.,]+\s*m²/gi) || []).slice(0, 5).join(' | '));
  console.log('datas:', (dtxt.match(/\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?/g) || []).slice(0, 8).join(' | '));
  console.log('praças (trecho):', (dtxt.match(/1[ªa][\s\S]{0,200}/i) || [])[0]?.replace(/\s+/g, ' ').slice(0, 260));
  console.log('modalidade/tipo pistas:', (dtxt.match(/(judicial|extrajudicial|venda direta|desocupad|ocupad|matr[íi]cula|processo)[^.]{0,60}/gi) || []).slice(0, 5).join(' | '));
  console.log('PDFs:', [...new Set([...b.matchAll(/href=["']([^"']*\.pdf[^"']*)["']/gi)].map(m => m[1]))].slice(0, 6).join(' | '));
  console.log('imgs lote:', [...new Set([...b.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]))].filter(u => /lote|imovel|upload|storage|foto/i.test(u)).slice(0, 4).join(' | '));
  console.log('\ncorpo (1400c):', dtxt.slice(0, 1400));
})();
