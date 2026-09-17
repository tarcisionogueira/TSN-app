// TEMPORÁRIO — o fix de pacote já gravou 13 imóveis novos (CDHU-52 completo), mas os /lote/ do
// evento "02-imoveis-em-burisp" (o caso original reportado pelo dono) E os de "imoveis-em-ba-
// mg-e-pr"/"imoveis-em-sp-e-pr" ficaram fora — 25 descartados bate exato com 12 containers +
// 2(buri) + 7(ba-mg-pr) + 4(sp-pr). CDHU funcionou, esses três não — usa o MESMO parser de
// produção (parseDetalhe/checarQualidade reais) sobre as URLs reais pra achar a diferença.
import puppeteer from 'puppeteer';
import cfg from './lib/motor/fontes/albertomacedo.mjs';

const URLS = [
  'https://www.albertomacedoleiloes.com.br/lote/1-lote-residencial-buri-residence',
  'https://www.albertomacedoleiloes.com.br/lote/2-lote-residencial-buri-residence',
];

async function abrirIsolado(browser, url) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) { console.log(`  erro ao navegar: ${e.message}`); }
  await new Promise(r => setTimeout(r, 3000));
  const html = await page.content();
  await ctx.close();
  return { status, html };
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const url of URLS) {
    console.log(`\n### ${url}`);
    const { status, html } = await abrirIsolado(browser, url);
    console.log(`  status: ${status} · html: ${html.length} chars`);
    let det;
    try {
      det = cfg.parse.parseDetalhe(html, url);
      console.log('  parseDetalhe:', JSON.stringify({
        titulo: det.titulo, cidade: det.cidade, estado: det.estado,
        valor_avaliacao: det.valor_avaliacao, valor_minimo: det.valor_minimo,
        modalidade: det.modalidade, encerrado: det.encerrado, numero_matricula: det.numero_matricula,
      }));
    } catch (e) { console.log(`  ERRO em parseDetalhe: ${e.message}`); continue; }
    try {
      const row = cfg.parse.montarRow(url, det, cfg.tenants[0]);
      const q = cfg.parse.checarQualidade(row, { estrito: false });
      console.log('  checarQualidade:', JSON.stringify(q));
      console.log('  fonte_id:', row.fonte_id);
    } catch (e) { console.log(`  ERRO em checarQualidade/montarRow: ${e.message}`); }
    const idUrl = cfg.parse.idDaUrl(url);
    console.log('  idDaUrl:', idUrl);
  }
  await browser.close();
  console.log('\n═══ FIM');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
