/**
 * Teste DESCARTÁVEL (19/09) — o recon de rede anterior (scripts/_teste-leiloar-rede.mjs,
 * já removido) mostrou que crleiloes.com.br, leiloesuberlandia.com.br e lucasleiloeiro.com.br
 * (a rede "Plataforma Leiloar" + lucasleiloeiro) travam no desafio JS do Cloudflare quando o
 * Puppeteer comum visita a página — nenhuma chamada de dado real passa, só o desafio.
 *
 * Antes de comprometer cota do Bright Data (pago) nesses 3 domínios, testa se
 * `puppeteer-extra` + `puppeteer-extra-plugin-stealth` (grátis, sem proxy) já basta pra
 * passar pelo desafio — evasão de fingerprinting básica costuma resolver Cloudflare em modo
 * "managed challenge" leve, mas não resolve um desafio com CAPTCHA visível.
 *
 * Dependências instaladas ad-hoc no workflow (--no-save), não vão pro package.json a menos
 * que este teste confirme que valem a pena.
 */
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

async function testarAlvo(nome, url, seletorEsperado) {
  console.log(`\n=== ${nome} (${url}) ===`);
  const browser = await puppeteerExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    const respostasDeDado = [];
    page.on('response', async (res) => {
      const rtype = res.request().resourceType();
      if (rtype !== 'xhr' && rtype !== 'fetch') return;
      const u = res.url();
      if (/cdn-cgi|challenges\.cloudflare\.com/.test(u)) return; // ignora o próprio desafio
      respostasDeDado.push({ url: u, status: res.status() });
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => console.log(`  goto ERRO: ${String(e.message).slice(0, 120)}`));
    await new Promise((r) => setTimeout(r, 5000));
    const titulo = await page.title().catch(() => '');
    const bodyLen = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0);
    const temDesafio = await page.evaluate(() => /just a moment|verifying you are human|checking your browser/i.test(document.body.innerText)).catch(() => false);
    let achouSeletor = null;
    if (seletorEsperado) {
      achouSeletor = await page.evaluate((sel) => document.querySelectorAll(sel).length, seletorEsperado).catch(() => null);
    }
    console.log(`  título="${titulo}" · bodyLen=${bodyLen} · ainda no desafio Cloudflare: ${temDesafio}`);
    if (seletorEsperado) console.log(`  seletor "${seletorEsperado}" encontrado: ${achouSeletor}`);
    console.log(`  respostas XHR/fetch de DADO real (fora do desafio): ${respostasDeDado.length}`);
    for (const r of respostasDeDado.slice(0, 6)) console.log(`    ${r.status} ${r.url}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

await testarAlvo('crleiloes.com.br', 'https://www.crleiloes.com.br/leiloes', 'article.pl15-card');
await testarAlvo('leiloesuberlandia.com.br', 'https://www.leiloesuberlandia.com.br/leiloes', 'article.pl15-card');
await testarAlvo('lucasleiloeiro.com.br', 'https://www.lucasleiloeiro.com.br/busca/#Engine=Start&Pagina=1&Busca=&Mapa=&ID_Categoria=88', null);
