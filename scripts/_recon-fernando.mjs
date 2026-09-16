// TEMPORÁRIO — recon do FERNANDOLEILOEIRO (fernandoleiloeiro.com.br, Fernando Caetano Moreira
// Filho). Já documentado (07/09) como 100% bloqueado por Cloudflare no runner de datacenter.
// Mesma técnica do recon-crepaldi.mjs (intercepta chamadas de API pra achar stores.id da rede
// Superbid, como funcionou pro KRONLEILOES), mas com espera MAIOR pro challenge ter mais
// chance de resolver — a 1ª tentativa (espera padrão 4s) ficou presa em "Um momento…".
import puppeteer from 'puppeteer';

const SITE = process.env.RECON_SITE || 'https://www.fernandoleiloeiro.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const chamadas = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/offer-query|superbid|\/api\/|graphql|offers/i.test(u)) chamadas.push(`${req.method()} ${u}`);
  });

  for (const rota of ['/categorias/imoveis', '/imoveis', '/']) {
    console.log(`\n=== Abrindo ${SITE}${rota} ===`);
    try {
      await page.goto(`${SITE}${rota}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 12000)); // espera bem maior, pro challenge resolver
      console.log(`   título: ${await page.title()}`);
      console.log(`   chamadas de API até agora: ${chamadas.length}`);
    } catch (e) {
      console.log(`   !! falhou: ${e.message}`);
      continue;
    }
    if (chamadas.length) break;
  }

  console.log('\n=== CHAMADAS DE API OBSERVADAS ===');
  const unicas = [...new Set(chamadas)];
  if (!unicas.length) console.log('   (nenhuma)');
  for (const c of unicas.slice(0, 40)) console.log('  ', c.slice(0, 240));

  const ids = new Set();
  for (const c of unicas) {
    for (const m of c.matchAll(/stores\.id[:=](\d+)/g)) ids.add(m[1]);
    for (const m of c.matchAll(/portalId=\[?([\d,]+)\]?/g)) ids.add(`portal:${m[1]}`);
  }
  console.log('\n=== IDs ENCONTRADOS ===');
  console.log(ids.size ? `   ${[...ids].join(' · ')}` : '   (nenhum)');

  // Se não achou nenhuma API, dumpa o HTML final pra saber se é Cloudflare challenge preso ou
  // conteúdo real que não bate no padrão esperado.
  if (!unicas.length) {
    const html = await page.content();
    console.log(`\n--- HTML final: ${html.length} bytes ---`);
    console.log('cf-mitigated/challenge:', /cf-mitigated|Just a moment|challenge-platform|__CF\$cv\$params/i.test(html));
    console.log('Um momento (nosso preloader):', /um momento/i.test(html));
    console.log(html.slice(0, 1500));
  }

  await browser.close();
  console.log('\n=== FIM DO RECON ===');
}
main();
