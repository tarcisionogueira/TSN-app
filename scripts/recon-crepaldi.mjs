/**
 * RECON do CREPALDI — descobre a premissa VIVA do site contra a do scraper.
 *
 * Contexto (07/08): a fonte CREPALDI nunca capturou um lote sequer. O log do runner mostra
 * que o código está bom e que o problema é o parâmetro:
 *
 *     Crepaldi Leilões — API offers (loja 16139, somente abertos)...
 *         Crepaldi Leilões: 0 offers abertas coletadas
 *
 * enquanto o MESMO código, três linhas acima, faz a loja 16091 (Total Leilões) devolver 110
 * offers. Ou seja: ou o `stores.id` 16139 está errado, ou o Crepaldi não é white-label do
 * Superbid. Este script responde isso olhando o que o PRÓPRIO site pede.
 *
 * Só LÊ e imprime — não grava nada no banco, não usa Bright Data (pago) e não chama IA.
 * Custo: zero (Actions é gratuito em repositório público).
 *
 * Uso: workflow_dispatch de .github/workflows/recon-crepaldi.yml
 */
import puppeteer from 'puppeteer';

const SITE = process.env.RECON_SITE || 'https://www.crepaldileiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const log = (...a) => console.log(...a);

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  // 1) INTERCEPTA as chamadas que o site faz. É aqui que o `stores.id` verdadeiro aparece:
  //    o white-label do Superbid monta a URL de offer-query com o próprio id da loja.
  const chamadas = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/offer-query|superbid|\/api\/|graphql|offers/i.test(u)) chamadas.push(`${req.method()} ${u}`);
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (!/offer-query|offers/i.test(u)) return;
    try {
      const j = await res.json();
      const n = (j?.offers || j?.content || j?.results || j?.items || (Array.isArray(j) ? j : []))?.length;
      log(`   ← resposta ${res.status()} de ${u.slice(0, 140)} → ${n ?? '?'} itens`);
    } catch { /* nem toda resposta é JSON */ }
  });

  for (const rota of ['/categorias/imoveis', '/imoveis', '/']) {
    log(`\n=== Abrindo ${SITE}${rota} ===`);
    try {
      await page.goto(`${SITE}${rota}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 4000));
      log(`   título: ${await page.title()}`);
    } catch (e) {
      log(`   !! falhou: ${e.message}`);
      continue;
    }
    if (chamadas.length) break;
  }

  log('\n=== CHAMADAS DE API OBSERVADAS ===');
  const unicas = [...new Set(chamadas)];
  if (!unicas.length) log('   (nenhuma — o site provavelmente NÃO é white-label do Superbid)');
  for (const c of unicas.slice(0, 40)) log('  ', c.slice(0, 240));

  // 2) Extrai qualquer `stores.id` / portalId que apareça nas chamadas — o número que o
  //    scraper precisa. Se sair diferente de 16139, achamos a causa.
  const ids = new Set();
  for (const c of unicas) {
    for (const m of c.matchAll(/stores\.id[:=](\d+)/g)) ids.add(m[1]);
    for (const m of c.matchAll(/portalId=\[?([\d,]+)\]?/g)) ids.add(`portal:${m[1]}`);
  }
  log('\n=== IDs ENCONTRADOS ===');
  log(ids.size ? `   ${[...ids].join(' · ')}` : '   (nenhum)');
  log(`   O scraper usa hoje: stores.id=16139`);

  // 3) Confirma direto na API pública: a loja 16139 tem MESMO 0 ofertas abertas?
  //    Consulta sem fieldList (payload cheio), igual à última carta do scraper.
  log('\n=== TESTE DIRETO NA API (loja 16139 vs. as achadas) ===');
  const candidatos = ['16139', ...[...ids].filter((x) => !x.startsWith('portal:'))];
  for (const id of [...new Set(candidatos)]) {
    const url = `https://offer-query.superbid.net/offers/?filter=stores.id:${id}&locale=pt_BR&orderBy=endDate:asc&pageNumber=1&pageSize=5&portalId=[2,15]&preOrderBy=orderByFirstOpenedOffers&requestOrigin=store&searchType=opened&timeZoneId=UTC`;
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { headers: { Accept: 'application/json' } });
        const t = await res.text();
        let n = null;
        try { const j = JSON.parse(t); n = (j.offers || j.content || j.results || j.items || (Array.isArray(j) ? j : []))?.length; } catch { /* */ }
        return { status: res.status, n, amostra: t.slice(0, 200) };
      }, url);
      log(`   loja ${id}: HTTP ${r.status} · ${r.n ?? '?'} ofertas · ${r.amostra.replace(/\s+/g, ' ').slice(0, 120)}`);
    } catch (e) { log(`   loja ${id}: erro ${e.message}`); }
  }

  await browser.close();
  log('\n=== FIM DO RECON ===');
}

main().catch((e) => { console.error('recon falhou:', e); process.exit(1); });
