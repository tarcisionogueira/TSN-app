/**
 * Teste DESCARTÁVEL (19/09) — recon com Puppeteer (captura de rede real) para 4 leiloeiros
 * pendentes do radar, todos exigindo JS/AJAX que um fetch estático não revela:
 *
 * 1) crleiloes.com.br e leiloesuberlandia.com.br rodam na mesma "Plataforma Leiloar"
 *    (confirmado via footer/CDN assets.mercadoleiloar.com.br) — se acharmos o endpoint AJAX
 *    real da busca em UM, o mesmo scraper cobre os dois (e talvez outros tenants Leiloar).
 * 2) lucasleiloeiro.com.br usa rota SPA por hash (#Engine=Start&...) — precisa navegador.
 * 3) sfleiloes.com.br tem URLs reais de /leilao/{id} e /lote/{id} na home, mas parece
 *    Laravel+SPA (pasta /build) — precisa achar o endpoint de listagem paginada.
 * 4) vipleiloes.com.br — kronbergleiloes.com.br linka para lá; checar se os lotes do
 *    Kronberg aparecem hospedados nessa plataforma (evitaria escrever scraper próprio p/ Kronberg).
 *
 * Grátis: Puppeteer sem proxy, com interceptação de rede (captura toda resposta XHR/fetch
 * JSON/HTML relevante em vez de adivinhar o endpoint por leitura de JS minificado).
 */
import puppeteer from 'puppeteer';

async function comCapturaDeRede(url, { timeout = 40000, esperaMs = 3000, filtro = null } = {}) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const achados = [];
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    page.on('response', async (res) => {
      try {
        const req = res.request();
        const rtype = req.resourceType();
        if (rtype !== 'xhr' && rtype !== 'fetch') return;
        const u = res.url();
        if (filtro && !filtro(u)) return;
        const ct = res.headers()['content-type'] || '';
        let corpo = '';
        if (ct.includes('json') || ct.includes('text') || ct.includes('html')) {
          corpo = (await res.text().catch(() => '')).slice(0, 800);
        }
        achados.push({ url: u, status: res.status(), contentType: ct, corpo });
      } catch { /* ignora resposta que já fechou */ }
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout }).catch((e) => achados.push({ erroNavegacao: String(e.message).slice(0, 150) }));
    await new Promise((r) => setTimeout(r, esperaMs));
  } finally {
    await browser.close().catch(() => {});
  }
  return achados;
}

async function testeCrleiloes() {
  console.log('\n=== crleiloes.com.br/leiloes (Plataforma Leiloar) ===');
  const achados = await comCapturaDeRede('https://www.crleiloes.com.br/leiloes');
  console.log(`XHR/fetch capturados: ${achados.length}`);
  for (const a of achados) console.log(JSON.stringify(a).slice(0, 500));
}

async function testeUberlandia() {
  console.log('\n=== leiloesuberlandia.com.br/leiloes (mesma Plataforma Leiloar) ===');
  const achados = await comCapturaDeRede('https://www.leiloesuberlandia.com.br/leiloes');
  console.log(`XHR/fetch capturados: ${achados.length}`);
  for (const a of achados) console.log(JSON.stringify(a).slice(0, 500));
}

async function testeLucas() {
  console.log('\n=== lucasleiloeiro.com.br (SPA por hash, categoria imóveis) ===');
  const achados = await comCapturaDeRede('https://www.lucasleiloeiro.com.br/busca/#Engine=Start&Pagina=1&Busca=&Mapa=&ID_Categoria=88', { esperaMs: 4000 });
  console.log(`XHR/fetch capturados: ${achados.length}`);
  for (const a of achados) console.log(JSON.stringify(a).slice(0, 500));
}

async function testeSfleiloes() {
  console.log('\n=== sfleiloes.com.br (Laravel/SPA — achar endpoint de listagem) ===');
  const achados = await comCapturaDeRede('https://sfleiloes.com.br/');
  console.log(`XHR/fetch capturados: ${achados.length}`);
  for (const a of achados) console.log(JSON.stringify(a).slice(0, 500));
}

async function testeVipKronberg() {
  console.log('\n=== vipleiloes.com.br — kronbergleiloes.com.br está hospedado lá? ===');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.goto('https://www.vipleiloes.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    const titulo = await page.title();
    const temKronberg = await page.evaluate(() => document.body.innerText.toLowerCase().includes('kronberg'));
    console.log(`título="${titulo}" · menciona "kronberg" no corpo renderizado: ${temKronberg}`);
    if (!temKronberg) {
      const linksLeiloeiro = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a')).map((a) => a.textContent.trim()).filter(Boolean).slice(0, 30)
      );
      console.log(`primeiros links/textos da home (procurando seção "leiloeiros"): ${JSON.stringify(linksLeiloeiro)}`);
    }
  } catch (e) {
    console.log(`vipleiloes → ERRO: ${String(e.message).slice(0, 150)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

await testeCrleiloes();
await testeUberlandia();
await testeLucas();
await testeSfleiloes();
await testeVipKronberg();
