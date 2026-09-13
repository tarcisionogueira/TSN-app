/**
 * RECON — LJUD, estrutura real dos cards em /veiculos/carros (achado no recon anterior:
 * é HTML renderizado no servidor, 1196 elementos tipo card/lote/item, ZERO chamada de API —
 * ou seja, não existe endpoint pra imitar, o extrator tem que ler o DOM direto, como já é
 * feito para Suporte/WebLeilões). Este recon pega o outerHTML de 3 cards reais + testa se
 * existe paginação (numerada ou "carregar mais") pra eu saber como percorrer o catálogo
 * inteiro sem adivinhar.
 *
 * Uso: node scripts/recon-ljud-carros-cards.mjs
 */
import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/veiculos/carros', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2000));

    const info = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      // Acha o menor ancestral comum repetido que tenha link + preço — candidato a "card".
      const candidatos = [...document.querySelectorAll('[class*="card"], [class*="lote"], [class*="item"]')]
        .filter((el) => el.querySelector('a[href]') && /R\$/.test(el.textContent || ''));
      // Filtra pra pegar só os elementos "folha" (sem outro candidato dentro dele) — evita
      // pegar o container gigante que engloba a lista inteira.
      const folhas = candidatos.filter((el) => !candidatos.some((outro) => outro !== el && el.contains(outro)));
      const amostras = folhas.slice(0, 3).map((el) => ({
        classe: el.className,
        outerHTML: el.outerHTML.slice(0, 2000),
      }));
      // Paginação: procura botão "carregar mais" / "próxima" / números de página.
      const paginacao = [...document.querySelectorAll('a, button')]
        .map((el) => norm(el.textContent))
        .filter((t) => /carregar mais|pr[oó]xima|pr[oó]ximo|p[aá]gina|\bver mais\b/i.test(t))
        .slice(0, 10);
      // Contagem total anunciada na página (ex.: "1.196 resultados", "Carros (1196)").
      const bodyText = norm(document.body.innerText).slice(0, 3000);
      const totalMatch = bodyText.match(/(\d[\d.,]{2,})\s*(resultados|imóveis|ve[ií]culos|itens|lotes)/i);
      return {
        totalCandidatosFolha: folhas.length,
        totalCandidatosBruto: candidatos.length,
        amostras,
        paginacao,
        totalAnunciado: totalMatch ? totalMatch[0] : null,
        titulo: document.title,
      };
    });

    console.log(`\n════ LJUD /veiculos/carros — estrutura ════`);
    console.log(`título: ${info.titulo}`);
    console.log(`total anunciado na página: ${info.totalAnunciado}`);
    console.log(`candidatos "folha" (prováveis cards): ${info.totalCandidatosFolha} (bruto antes do filtro: ${info.totalCandidatosBruto})`);
    console.log(`sinais de paginação encontrados: ${JSON.stringify(info.paginacao)}`);
    console.log(`\n════ Amostras de card (até 3) ════`);
    info.amostras.forEach((a, i) => {
      console.log(`\n--- amostra ${i + 1} (classe="${a.classe}") ---`);
      console.log(a.outerHTML);
    });
  } catch (e) {
    console.error('Recon falhou:', e?.message || e);
  } finally {
    await browser.close();
  }
  console.log('\n✅ Recon concluído.');
}

main();
