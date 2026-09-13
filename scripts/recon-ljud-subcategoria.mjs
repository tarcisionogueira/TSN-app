/**
 * RECON — LJUD, mais uma camada: /veiculos é só um HUB (achado no recon anterior — 0
 * chamadas de API, só links pra subcategorias: Aeronaves, Caminhões, Carros, Motos,
 * Ônibus, Outros veículos, Reboque e semireboque, Tratores, Veículos Náuticos, Veículos
 * Pesados). Este recon entra em "Carros" (maior volume esperado) e intercepta a chamada
 * REAL que a subcategoria faz — mesmo mecanismo já usado pra Sodré, aplicado aqui em vez
 * de continuar adivinhando `tipo=`/`categoria=`.
 *
 * Uso: node scripts/recon-ljud-subcategoria.mjs
 */
import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const chamadas = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/api\.leiloesjudiciais\.com\.br\/core\/api\//.test(url)) {
      chamadas.push({ url, method: req.method(), body: req.postData() || null });
    }
  });
  try {
    await page.setUserAgent('Mozilla/5.0');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/veiculos', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Lista TODOS os links de subcategoria encontrados na página (texto + href), pra eu
    // ver as opções antes de escolher qual seguir.
    const subcategorias = await page.evaluate(() => {
      const nomes = ['Aeronaves', 'Caminhões', 'Carros', 'Motos', 'Ônibus', 'Outros veículos', 'Reboque e semireboque', 'Tratores', 'Veículos Náuticos', 'Veículos Pesados'];
      const out = [];
      document.querySelectorAll('a[href]').forEach((a) => {
        const txt = (a.textContent || '').trim();
        if (nomes.includes(txt)) out.push({ nome: txt, href: a.href });
      });
      return out;
    });
    console.log('\n════ Subcategorias encontradas em /veiculos ════');
    for (const s of subcategorias) console.log(`  ${s.nome}: ${s.href}`);

    const carros = subcategorias.find((s) => s.nome === 'Carros');
    if (!carros) { console.log('\n⚠️ Link de "Carros" não encontrado — abortando.'); await browser.close(); return; }

    console.log(`\n════ Entrando em Carros: ${carros.href} ════`);
    chamadas.length = 0; // só as chamadas feitas DEPOIS de entrar na subcategoria
    await page.goto(carros.href, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`\n════ Chamadas de API interceptadas em Carros (${chamadas.length}) ════`);
    for (const c of chamadas) {
      console.log(`  ${c.method} ${c.url}`);
      if (c.body) console.log(`    body: ${c.body.slice(0, 400)}`);
    }
    if (!chamadas.length) {
      const titulo = await page.title();
      const cardsGenericos = await page.evaluate(() => document.querySelectorAll('[class*="card"], [class*="lote"], [class*="item"]').length);
      console.log(`  Nenhuma chamada interceptada. título="${titulo}" elementos tipo card/lote/item: ${cardsGenericos}`);
    }
  } catch (e) {
    console.error('Recon falhou:', e?.message || e);
  } finally {
    await browser.close();
  }
  console.log('\n✅ Recon concluído.');
}

main();
