/**
 * RECON — descobre o(s) campo(s) de GALERIA de fotos na API offer-query.superbid.net.
 *
 * scraperSuperbidNet (scripts/scraper-puppeteer.mjs) só pede `product.thumbnailUrl` no
 * fieldList — 1 foto só. Serve SUPERBID, SOLD, SBID9, SBID21, TOTALLEILOES, CREPALDI,
 * KRONLEILOES (7 fontes, 2ª maior oportunidade de galeria depois do LJUD). Antes de
 * adivinhar nome de campo, pede o payload CRU de 2 ofertas com um fieldList expandido
 * testando candidatos plausíveis (pictures/images/gallery, em product/offerDetail), e
 * imprime toda chave do objeto que pareça foto — pra escrever o fix com dado real, não
 * suposição (CLAUDE.md: "rodar em seco sobre dado real antes de gravar").
 *
 * Descartável: não referenciado pelo scraper de produção. Rodar via workflow_dispatch.
 */
import puppeteer from 'puppeteer';

const FIELDS_CANDIDATOS = [
  'id', 'linkURL', 'product.thumbnailUrl',
  'product.pictures', 'product.images', 'product.gallery', 'product.photos',
  'offerDetail.pictures', 'offerDetail.images', 'offerDetail.gallery', 'offerDetail.photos',
  'product.mediaGallery', 'product.imageGallery', 'auction.pictures',
].join(';');

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  console.log('=== TESTE 1: portal público (SUPERBID, portalId=[2]) ===');
  await page.goto('https://www.superbid.net/categorias/imoveis', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  const dump = async (label, url) => {
    console.log(`\n--- ${label} ---`);
    console.log(url);
    const out = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        const status = r.status;
        if (!r.ok) return { status, ok: false };
        const d = await r.json();
        const offers = d.offers || d.content || d.results || d.items || (Array.isArray(d) ? d : []);
        return { status, ok: true, n: offers.length, primeira: offers[0] || null };
      } catch (e) { return { erro: String(e && e.message || e) }; }
    }, url);
    console.log(`status=${out.status} ok=${out.ok} n=${out.n}`);
    if (out.primeira) {
      console.log('CHAVES do 1º item:', Object.keys(out.primeira).join(', '));
      if (out.primeira.product) console.log('CHAVES de product:', Object.keys(out.primeira.product).join(', '));
      if (out.primeira.offerDetail) console.log('CHAVES de offerDetail:', Object.keys(out.primeira.offerDetail).join(', '));
      // Imprime qualquer chave/valor que pareça imagem (nome da chave ou URL contém
      // foto/image/picture/gallery/thumb/media), em qualquer profundidade rasa (2 níveis).
      const achados = [];
      const olha = (obj, prefixo, prof) => {
        if (!obj || typeof obj !== 'object' || prof > 2) return;
        for (const [k, v] of Object.entries(obj)) {
          const kl = k.toLowerCase();
          if (/foto|image|picture|gallery|thumb|media/i.test(kl)) achados.push(`${prefixo}${k} = ${JSON.stringify(v).slice(0, 300)}`);
          else if (v && typeof v === 'object') olha(v, `${prefixo}${k}.`, prof + 1);
        }
      };
      olha(out.primeira, '', 0);
      console.log('CAMPOS QUE PARECEM FOTO:\n' + (achados.join('\n') || '(nenhum achado por nome de chave)'));
      console.log('\nOFERTA COMPLETA (1ª, truncada 4000 chars):');
      console.log(JSON.stringify(out.primeira).slice(0, 4000));
    }
  };

  await dump(
    'SUPERBID portal público, fieldList expandido',
    `https://offer-query.superbid.net/offers/?portalId=[2]&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=1&pageSize=1&orderBy=endDate:asc&fieldList=${FIELDS_CANDIDATOS}`
  );

  console.log('\n=== TESTE 2: sem fieldList nenhum (payload cheio, como o site usa) ===');
  await dump(
    'SUPERBID portal público, SEM fieldList (payload completo)',
    `https://offer-query.superbid.net/offers/?portalId=[2]&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=1&pageSize=1&orderBy=endDate:asc`
  );

  await browser.close();
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
