// TEMPORÁRIO — recon do KLEILOES (kleiloes.com.br, Werno Klöckner Júnior) antes de escrever
// o scraper. Pedido do dono: implementar depois de já ter avaliado a dificuldade como BAIXA
// (mesma rede "Suporte Leilões" do JELEILOES já integrado). Objetivo: confirmar se a URL do
// lote/estrutura bate com o parser de JELEILOES (lib/jeleiloes-parse.mjs) — se bater, vira só
// mais um tenant; se não, precisa de parser próprio. Fetch puro, ZERO Bright Data.
const BASE = 'https://kleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const html = await r.text();
  return { status: r.status, html, len: html.length };
}

function extrairHrefsLote(html) {
  // Mesmo padrão do JELEILOES: /oferta(s)/leilao/imoveis/<cat>/<id>/(id-)?<id2>/<slug>
  const m1 = [...html.matchAll(/href=["']([^"']*\/ofertas?\/leilao\/imoveis\/[a-z0-9-]+\/\d+\/(?:id-)?(\d+)\/[a-z0-9-]+)\/?["']/gi)];
  return m1;
}

async function main() {
  console.log(`=== ${BASE}/imoveis ===`);
  const p1 = await get('/imoveis');
  console.log(`status ${p1.status} · ${p1.len} bytes`);

  const lotesPadraoJE = extrairHrefsLote(p1.html);
  console.log(`\nURLs no padrão JELEILOES (/ofertas/leilao/imoveis/...): ${lotesPadraoJE.length}`);
  for (const m of lotesPadraoJE.slice(0, 5)) console.log(`  ${m[1]}`);

  if (!lotesPadraoJE.length) {
    console.log('\n--- Nenhuma no padrão JE. Todos os <a href> únicos que parecem lote (até 40) ---');
    const vistos = new Set();
    for (const m of p1.html.matchAll(/href=["']([^"']+)["']/gi)) {
      const h = m[1];
      if (vistos.has(h)) continue;
      if (/imov|lote|oferta|leilao\/|bem\//i.test(h) && !/\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(h)) {
        vistos.add(h);
        console.log(`  ${h}`);
        if (vistos.size >= 40) break;
      }
    }
  }

  console.log(`\n--- Assinaturas de plataforma no HTML ---`);
  console.log('static.suporteleiloes.com.br:', /static\.suporteleiloes\.com\.br/i.test(p1.html));
  console.log('stats.suporteleiloes.com.br:', /stats\.suporteleiloes\.com\.br/i.test(p1.html));
  console.log('build/images (template antigo):', /\/build\/images\//i.test(p1.html));

  // Se achou alguma URL de lote, busca o detalhe e roda um recon leve nele também.
  const primeiraUrl = lotesPadraoJE[0]?.[1];
  if (primeiraUrl) {
    const abs = new URL(primeiraUrl, BASE).href;
    console.log(`\n=== Detalhe: ${abs} ===`);
    const r = await fetch(abs, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    const html = await r.text();
    console.log(`status ${r.status} · ${html.length} bytes`);
    console.log('tem <table> com "Valor de Avaliação":', /<table[\s\S]*?Valor\s+de\s+Avalia[çc][ãa]o[\s\S]*?<\/table>/i.test(html));
    console.log('tem "Lance Inicial":', /Lance\s+Inicial/i.test(html));
    console.log('tem link .pdf:', (html.match(/href=["'][^"']+\.pdf[^"']*["']/gi) || []).length, 'ocorrência(s)');
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
      console.log(`  pdf: ${m[1]} · label: ${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    }
  }
}
main();
