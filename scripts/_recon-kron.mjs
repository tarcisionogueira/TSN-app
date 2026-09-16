// TEMPORÁRIO — recon do KRONLEILOES (kronleiloes.com.br, Helcio Kronberg) antes de escrever o
// scraper. Próximo da fila de candidatos do EDITAL_DJEN (19 imóveis, maior volume dos que
// sobraram depois de SARAIVA/MARCOANTONIO terem saído — já estavam integrados sob SUPORTE).
// Fetch puro, ZERO Bright Data — só pra saber se Cloudflare bloqueia direto ou não antes de
// decidir a estratégia (dom-puppeteer grátis vs Bright Data pago).
const BASE = 'https://kronleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function assinatura(html) {
  const marcas = [];
  if (/cf-mitigated|Just a moment|__CF\$cv\$params|challenge-platform/i.test(html)) marcas.push('CLOUDFLARE_CHALLENGE');
  if (/static\.suporteleiloes\.com\.br|stats\.suporteleiloes\.com\.br/i.test(html)) marcas.push('SUPORTE_LEILOES(rede)');
  if (/window\.__NUXT__|_next\/static|__NEXT_DATA__/i.test(html)) marcas.push('SPA(NUXT/NEXT)');
  return marcas;
}

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
  const candidatos = ['/', '/imoveis', '/buscador?categoria=2', '/oferta', '/leiloes'];
  for (const p of candidatos) {
    const r = await get(p);
    const marcas = r.html ? assinatura(r.html) : [];
    console.log(`${p} -> HTTP ${r.status} · ${r.len} bytes · marcas: [${marcas.join(', ') || 'nenhuma'}]${r.erro ? ` · ERRO: ${r.erro}` : ''}`);
    if (r.status === 200 && p === '/') {
      const lotes = extrairHrefsLote(r.html);
      console.log(`  URLs padrão JELEILOES na HOME: ${lotes.length}`);
      console.log('  --- links de navegação (até 30, únicos) ---');
      const vistos = new Set();
      for (const m of r.html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,40}?)<\/a>/gi)) {
        const href = m[1];
        if (vistos.has(href) || /\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(href)) continue;
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
