/**
 * RECON — antes de escrever scraper de veículo pra LJUD, Mega, WebLeilões e Zuk (13/09),
 * confirma ao vivo o que o código estático não dá pra confirmar sozinho:
 *
 * - LJUD: qual o valor de `tipo=` (querystring da API get-bens-por-estados/get-lotes) que
 *   devolve veículo? O código atual só confirma `tipo=3` = Imóveis (comentário na linha
 *   ~1875 de scraper-puppeteer.mjs) — o valor de veículo nunca foi testado.
 * - Mega: a URL /veiculos usa o MESMO seletor `.card`/`[data-key]` da listagem de imóvel?
 *   E o mapeamento de subcategoria por segmento de path (`/imoveis/{categoria}/`) tem
 *   equivalente em `/veiculos/{categoria}/`?
 * - WebLeilões: o recon anterior (leiloeiro_segmento_veiculos) achou a URL com `?tipo=
 *   Veículos`, mas o scraper de imóvel já usa `?categoria=imoveis` pro mesmo tipo de busca —
 *   os dois nomes de parâmetro convivem, ou só um funciona pra veículo?
 * - Zuk: a seção de veículo usa o mesmo `.card-property` e o mesmo padrão de link
 *   `/imovel/{uf}/{cidade}/...` (de onde o scraper de imóvel extrai localização), ou é
 *   outro seletor/padrão de URL?
 *
 * Sem essas respostas, escrever o scraper seria apostar num nome de campo/seletor — a
 * "forma nº 10" do CLAUDE.md: sairia 0 (ou pior, dado errado) e pareceria "sem veículo".
 *
 * Uso: node scripts/recon-veiculos-4fontes.mjs
 */
import puppeteer from 'puppeteer';

async function reconLJUD(log) {
  log('\n════ LJUD — testando valores de `tipo=` na API ════');
  // tipo=3 é Imóveis (confirmado); testa os vizinhos numéricos mais prováveis pra veículo,
  // sem assumir qual é — só reporta o que cada um devolve.
  for (const tipo of [1, 2, 4, 5, 6]) {
    const qs = `tipo=${tipo}&categoria=0&estado=&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null`;
    try {
      const r = await fetch(`https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados?${qs}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      const txt = await r.text();
      let total = null;
      try { const j = JSON.parse(txt); total = Array.isArray(j) ? j.length : (j?.total ?? j?.data?.length ?? null); } catch {} // padrao-ok: recon, resposta não-JSON só significa que este `tipo` não é válido — reportado como total=null logo abaixo
      log(`  tipo=${tipo}: HTTP ${r.status}, tamanho resposta ${txt.length}, total/len detectado: ${total}`);
      log(`    amostra: ${txt.slice(0, 300).replace(/\s+/g, ' ')}`);
    } catch (e) { log(`  tipo=${tipo}: erro ${String(e?.message || e).slice(0, 100)}`); }
  }
}

async function reconMega(browser, log) {
  log('\n════ Mega Leilões — /veiculos ════');
  const page = await browser.newPage();
  try {
    await page.goto('https://www.megaleiloes.com.br/veiculos?pagina=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    const info = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-key] .card');
      const primeiro = cards[0];
      const href = primeiro?.querySelector('a')?.href || null;
      const catMatch = href ? href.match(/\/veiculos\/([a-z-]+)\// ) : null;
      return {
        totalCards: cards.length,
        primeiroHref: href,
        categoriaDetectada: catMatch ? catMatch[1] : null,
        primeiroHtml: primeiro ? primeiro.outerHTML.slice(0, 600) : null,
      };
    });
    log(`  cards encontrados: ${info.totalCards}`);
    log(`  1º href: ${info.primeiroHref}`);
    log(`  categoria detectada no path: ${info.categoriaDetectada}`);
    log(`  html do 1º card (recorte): ${info.primeiroHtml}`);
  } catch (e) { log(`  erro: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon, nunca crítico
}

async function reconWebLeiloes(browser, log) {
  log('\n════ WebLeilões — comparando parâmetros de busca ════');
  for (const [nome, url] of [
    ['categoria=imoveis (o que o scraper de imóvel já usa)', 'https://www.webleiloes.com.br/busca?categoria=imoveis'],
    ['categoria=veiculos (mesmo padrão, chute)', 'https://www.webleiloes.com.br/busca?categoria=veiculos'],
    ['tipo=Ve%C3%ADculos (o que o recon de segmento achou)', 'https://www.webleiloes.com.br/busca?tipo=Ve%C3%ADculos'],
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1800));
      const info = await page.evaluate(() => {
        const todos = document.querySelectorAll('a[href*="/oferta/"]');
        const veiculo = document.querySelectorAll('a[href*="/oferta/"][href*="/veiculos/"]');
        const imovel = document.querySelectorAll('a[href*="/oferta/"][href*="/imoveis/"]');
        return { todos: todos.length, comVeiculos: veiculo.length, comImoveis: imovel.length, primeiroHref: todos[0]?.href || null };
      });
      log(`  [${nome}] total ofertas: ${info.todos}, com "/veiculos/" no href: ${info.comVeiculos}, com "/imoveis/" no href: ${info.comImoveis}`);
      log(`    1º href: ${info.primeiroHref}`);
    } catch (e) { /* padrao-ok: recon best-effort, erro reportado abaixo */ log(`  [${nome}] erro: ${String(e?.message || e).slice(0, 150)}`); }
    finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon, nunca crítico
  }
}

async function reconZuk(browser, log) {
  log('\n════ PortalZuk — /leilao-de-veiculos ════');
  const page = await browser.newPage();
  try {
    await page.goto('https://www.portalzuk.com.br/leilao-de-veiculos', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const info = await page.evaluate(() => {
      const porProperty = document.querySelectorAll('.card-property');
      // Chute de nome alternativo, só para log — não usado se vier vazio.
      const porVehicle = document.querySelectorAll('.card-vehicle, .card-veiculo, [class*="card"][class*="veic"]');
      const primeiro = porProperty[0] || porVehicle[0];
      const href = primeiro?.querySelector('a')?.href || primeiro?.href || null;
      return {
        comCardProperty: porProperty.length,
        comSeletorAlternativo: porVehicle.length,
        primeiroHref: href,
        temImovelNoHref: href ? /\/imovel\//.test(href) : null,
        temVeiculoNoHref: href ? /\/veiculo/.test(href) : null,
      };
    });
    log(`  .card-property encontrados: ${info.comCardProperty}`);
    log(`  seletor alternativo (chute) encontrados: ${info.comSeletorAlternativo}`);
    log(`  1º href: ${info.primeiroHref}`);
    log(`  href contém "/imovel/": ${info.temImovelNoHref} | contém "/veiculo": ${info.temVeiculoNoHref}`);
  } catch (e) { log(`  erro: ${String(e?.message || e).slice(0, 150)}`); }
  finally { await page.close().catch(() => {}); } // padrao-ok: fechar página best-effort em script de recon, nunca crítico
}

async function main() {
  const linhas = [];
  const log = (s) => { console.log(s); linhas.push(s); };
  await reconLJUD(log);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    await reconMega(browser, log);
    await reconWebLeiloes(browser, log);
    await reconZuk(browser, log);
  } finally { await browser.close(); }
  log('\n✅ Recon concluído.');
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
