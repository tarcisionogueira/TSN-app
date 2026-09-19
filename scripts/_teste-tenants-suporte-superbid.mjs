/**
 * Teste DESCARTÁVEL (19/09) — confirma se leilaobrasil.com.br responde no endpoint padrão
 * do SUPORTE (/buscador?categoria=2) e se "Dilson Moreira" aparece no feed da rede Superbid
 * (portalId 2, mesmo endpoint que scraperSuperbidNet já usa em produção) ANTES de cadastrar
 * qualquer um como tenant — o comentário de 20/08 já avisa que leilaobrasil voltou 0 lotes
 * uma vez; não repetir o mesmo erro sem checar de novo.
 *
 * Grátis: Puppeteer sem proxy (leilaobrasil, sem Cloudflare confirmado) + fetch direto na API
 * pública do Superbid (mesma usada em produção, sem Bright Data).
 */
import puppeteer from 'puppeteer';

async function testeLeilaoBrasil() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  try {
    await page.goto('https://leilaobrasil.com.br/buscador?categoria=2&pagina=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 1500));
    const n = await page.evaluate(() => document.querySelectorAll('article.lote-main, article[class*="lote-main"]').length);
    const titulo = await page.title();
    console.log(`leilaobrasil.com.br /buscador?categoria=2 → título="${titulo}" · article.lote-main encontrados: ${n}`);
    if (n === 0) {
      const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
      const h1 = await page.evaluate(() => document.querySelector('h1,h2')?.textContent || '');
      console.log(`  (0 lotes) bodyLen=${bodyLen} primeiro h1/h2="${h1}"`);
    }
  } catch (e) {
    console.log(`leilaobrasil.com.br → ERRO: ${String(e.message).slice(0, 150)}`);
  } finally { await browser.close().catch(() => {}); }
}

// MESMO endpoint que scraperSuperbidNet usa em produção (portalId 2, imóveis, abertos) —
// só sem fieldList de documentos (não precisamos aqui), pra achar "Dilson" no campo `store`
// em QUALQUER página (varre até 20 páginas de 100 = 2000 ofertas, teto de segurança).
async function testeDilsonSuperbid() {
  const achados = [];
  let totalVistos = 0;
  for (let n = 1; n <= 20; n++) {
    const url = `https://offer-query.superbid.net/offers/?portalId=[2]&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=${n}&pageSize=100&orderBy=endDate:asc&fieldList=id;store;product.shortDesc`;
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.log(`Superbid API pág ${n} → HTTP ${r.status}`); break; }
      const d = await r.json().catch(() => null);
      const offers = d?.offers || d?.content || d?.results || d?.items || (Array.isArray(d) ? d : []);
      if (!Array.isArray(offers) || !offers.length) { if (n === 1) console.log(`  payload bruto (500 chars): ${JSON.stringify(d).slice(0, 500)}`); break; }
      totalVistos += offers.length;
      for (const o of offers) if (String(o?.store || '').toLowerCase().includes('dilson')) achados.push(o);
      if (offers.length < 100) break; // última página
    } catch (e) { console.log(`Superbid API pág ${n} → ERRO: ${String(e.message).slice(0, 100)}`); break; }
  }
  console.log(`Superbid portalId=[2] imóveis → ${totalVistos} ofertas vistas · com "dilson" no store: ${achados.length}`);
  if (achados.length) console.log(JSON.stringify(achados.slice(0, 3)));
}

await testeLeilaoBrasil();
await testeDilsonSuperbid();
