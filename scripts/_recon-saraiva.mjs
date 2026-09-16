// TEMPORÁRIO — recon do SARAIVA (saraivaleiloes.com.br, Angela Saraiva Portes Souza) antes de
// escrever o scraper. Recon anterior (16/09) achou a home 200 com assinatura "Suporte Leilões"
// (mesma rede do JELEILOES/KLEILOES, já integrados), mas os caminhos padrão (/imoveis,
// /lotes/imoveis, /leiloes, /busca?categoria=imoveis) deram 404 — precisa achar o caminho
// real do catálogo antes de decidir se reaproveita o parser (tenant) ou precisa de algo novo.
// Fetch puro, ZERO Bright Data.
const BASE = 'https://saraivaleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function get(path) {
  try {
    const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
    const html = await r.text();
    return { status: r.status, html, len: html.length, url: r.url };
  } catch (e) {
    return { status: 0, html: '', len: 0, erro: e.message };
  }
}

function extrairHrefsLote(html) {
  return [...html.matchAll(/href=["']([^"']*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[a-z0-9-]+)\/?["']/gi)];
}

async function main() {
  const candidatos = ['/', '/imoveis', '/imovel', '/buscador?categoria=2', '/oferta', '/ofertas',
    '/leilao', '/leiloes-de-imoveis', '/categoria/imoveis', '/lotes', '/sitemap.xml', '/robots.txt'];
  for (const p of candidatos) {
    const r = await get(p);
    console.log(`${p} -> HTTP ${r.status}${r.url && r.url !== BASE + p ? ` (redirect: ${r.url})` : ''} · ${r.len} bytes${r.erro ? ` · ERRO: ${r.erro}` : ''}`);
    if (r.status === 200 && p === '/') {
      const lotes = extrairHrefsLote(r.html);
      console.log(`  URLs no padrão JELEILOES/KLEILOES na HOME: ${lotes.length}`);
      for (const m of lotes.slice(0, 5)) console.log(`    ${m[1]}`);
      console.log('  --- <a href> que parecem menu/navegação (até 30, únicos) ---');
      const vistos = new Set();
      for (const m of r.html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,40}?)<\/a>/gi)) {
        const href = m[1];
        if (vistos.has(href)) continue;
        if (/\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(href)) continue;
        const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        vistos.add(href);
        console.log(`    href="${href}" label="${label.slice(0, 40)}"`);
        if (vistos.size >= 30) break;
      }
    }
    await new Promise(res => setTimeout(res, 300));
  }
}
main();
