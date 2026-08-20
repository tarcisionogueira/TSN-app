/**
 * Recon PROFUNDO LeilãoPro Core (v2) — foca a CATEGORIA imóveis e o card real do lote.
 * Imprime: hrefs candidatos a detalhe (com id), HTML cru ao redor do 1º "Lance", e o
 * detalhe de 1 lote de imóvel. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE. Não grava nada.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const ALVOS = (process.env.LEILAOPRO_ALVOS || 'https://www.leffaleiloes.com.br').split(',').map(s => s.trim()).filter(Boolean);

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
  for (const BASE of ALVOS) {
    console.log(`\n╔═══════════════ ${BASE}/leilao/lotes/imoveis ═══════════════╗`);
    const L = await bdFetch(BASE + '/leilao/lotes/imoveis');
    const html = L.body;
    console.log(`HTTP ${L.status} len=${html.length}`);

    // TODOS os hrefs distintos (para achar o padrão de detalhe do lote).
    const todos = [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1]))];
    // candidatos a DETALHE: contêm dígito e não são categoria/nav/asset.
    const det = todos.filter(h => /\d/.test(h)
      && !/\.(css|js|png|jpe?g|svg|ico|woff2?)/i.test(h)
      && !/\/lotes\/[a-z-]+$/i.test(h)
      && !/(facebook|instagram|whats|tel:|mailto:|login|cadastr)/i.test(h));
    console.log(`\n[detalhe?] ${det.length} href(s) com id. Amostra:`);
    det.slice(0, 12).forEach(h => console.log('   ' + h));

    // HTML cru ao redor do 1º "Lance" (o card do lote).
    const iL = html.search(/lance\s*inicial|lance\s*atual|1[ªa]\s*pra/i);
    if (iL > 0) {
      const trecho = html.slice(Math.max(0, iL - 1500), iL + 400).replace(/\s+/g, ' ').trim();
      console.log(`\n[card cru ao redor do 1º "Lance"]:\n${trecho.slice(0, 1900)}`);
    } else {
      console.log('\n[card cru] não achei "Lance" no HTML da categoria.');
    }

    // Detalhe do 1º candidato.
    if (det.length) {
      const durl = det[0].startsWith('http') ? det[0] : BASE + (det[0].startsWith('/') ? det[0] : '/' + det[0]);
      const D = await bdFetch(durl);
      const b = D.body;
      const dtxt = b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`\n[detalhe] ${durl} → HTTP ${D.status} len=${b.length}`);
      console.log('   h1:', (b.match(/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      console.log('   title tag:', (b.match(/<title[^>]*>([\s\S]{0,160}?)<\/title>/i) || [])[1]?.trim());
      console.log('   R$ (8):', (dtxt.match(/R\$\s?[\d.,]+/g) || []).slice(0, 8).join(' | '));
      console.log('   cidade/UF:', (dtxt.match(/[A-Za-zÀ-ú .]{3,40}\/[A-Z]{2}\b/g) || []).slice(0, 8).join(' | '));
      console.log('   m²:', (dtxt.match(/[\d.,]+\s*m²/gi) || []).slice(0, 4).join(' | '));
      console.log('   datas:', (dtxt.match(/\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?/g) || []).slice(0, 8).join(' | '));
      console.log('   1ª/2ª praça trecho:', (dtxt.match(/1[ªa][^]{0,120}?2[ªa][^]{0,60}/i) || [])[0]?.slice(0, 220));
      console.log('   PDFs:', [...new Set([...b.matchAll(/href=["']([^"']*\.pdf[^"']*)["']/gi)].map(m => m[1]))].slice(0, 6).join(' | '));
      console.log('   og:image:', (b.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]);
      console.log('   corpo (1100c):', dtxt.slice(0, 1100));
    }
  }
  console.log('\nFim v2.');
})();
