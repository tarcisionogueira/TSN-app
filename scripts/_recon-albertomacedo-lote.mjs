// TEMPORÁRIO — recon do ALBERTOMACEDOLEILOES, rodada 2 (isolarSessao, igual produção).
// Rodada 1 confirmou: /lote/2-lote-residencial-buri-residence é uma página REAL, com dados
// completos (Avaliação R$70.000, matrícula 46417, praça única) — mas a HOME bateu 403 porque foi
// a 2ª navegação NA MESMA SESSÃO/contexto do browser (mesma assinatura de rate-limit por sessão
// já documentada em leiloeiro_conhecimento/albertomacedo.mjs). Esta rodada usa 1 BrowserContext
// incógnito NOVO por página (igual `isolarSessao` da produção) pra conseguir abrir HOME e a
// página pai do leilão (breadcrumb mostrou "Home | Leilão | Lote 2" — ou seja, /lote/N-slug é
// FILHO de um /leilao/<slug> que lista os lotes) sem apanhar do rate-limit.
import puppeteer from 'puppeteer';

const BASE = 'https://www.albertomacedoleiloes.com.br';
const LOTE_URL = process.env.LOTE_URL || `${BASE}/lote/2-lote-residencial-buri-residence`;

async function abrirIsolado(browser, url, espera = 4000) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) {
    console.log(`    erro ao navegar: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, espera));
  const html = await page.content();
  const texto = await page.evaluate(() => document.body.innerText).catch(() => '');
  const anchors = await page.$$eval('a', as => as.map(a => ({ href: a.getAttribute('href') || '', texto: (a.textContent || '').trim().slice(0, 60) })).filter(l => l.href)).catch(() => []);
  await ctx.close();
  return { status, html, texto, anchors };
}

function absolutas(anchors, base) {
  const out = new Map();
  for (const a of anchors) {
    try {
      const u = new URL(a.href, base);
      if (u.host.includes('albertomacedoleiloes.com.br')) out.set(u.pathname, { href: u.href, texto: a.texto });
    } catch { /* skip */ }
  }
  return [...out.values()];
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log(`🔎 RECON HEADLESS (isolarSessao) — ALBERTOMACEDOLEILOES\n`);

  console.log(`1) Página do LOTE (contexto isolado): ${LOTE_URL}`);
  const det = await abrirIsolado(browser, LOTE_URL);
  console.log(`  status: ${det.status} · challenge? ${/just a moment/i.test(det.html)}`);
  const linksDet = absolutas(det.anchors, BASE);
  const leilaoNoDet = linksDet.filter(l => /\/leilao\//i.test(l.href));
  console.log(`  ${det.anchors.length} <a> total · /leilao/ encontrados: ${leilaoNoDet.length}`);
  for (const l of leilaoNoDet.slice(0, 10)) console.log(`    /leilao/: ${l.href}  ("${l.texto}")`);
  const outrosLote = linksDet.filter(l => /\/lote\//i.test(l.href));
  console.log(`  outros /lote/ linkados NESTA página: ${outrosLote.length}`);
  for (const l of outrosLote.slice(0, 10)) console.log(`    /lote/: ${l.href}  ("${l.texto}")`);

  console.log(`\n2) HOME (contexto isolado, novo): ${BASE}/`);
  const home = await abrirIsolado(browser, `${BASE}/`);
  console.log(`  status: ${home.status} · challenge? ${/just a moment/i.test(home.html)} · <a> total: ${home.anchors.length}`);
  const linksHome = absolutas(home.anchors, BASE);
  const loteHome = linksHome.filter(l => /\/lote\//i.test(l.href));
  const leilaoHome = linksHome.filter(l => /\/leilao\//i.test(l.href));
  console.log(`  /lote/ na home: ${loteHome.length} · /leilao/ na home: ${leilaoHome.length}`);
  for (const l of loteHome.slice(0, 10)) console.log(`    /lote/: ${l.href}  ("${l.texto}")`);
  for (const l of leilaoHome.slice(0, 15)) console.log(`    /leilao/: ${l.href}  ("${l.texto}")`);

  // 3) Se a página do leilão-pai foi achada via breadcrumb do lote, abre ela (contexto isolado)
  //    e lista TODOS os /lote/ que aparecem — é a prova de "pacote com N lotes, cada um com URL própria".
  const paiCandidato = leilaoNoDet[0]?.href || leilaoHome.find(l => /buri/i.test(l.href))?.href;
  if (paiCandidato) {
    console.log(`\n3) Página PAI do leilão (contexto isolado): ${paiCandidato}`);
    const pai = await abrirIsolado(browser, paiCandidato);
    console.log(`  status: ${pai.status} · challenge? ${/just a moment/i.test(pai.html)} · <a> total: ${pai.anchors.length}`);
    const linksPai = absolutas(pai.anchors, BASE);
    const loteNoPai = linksPai.filter(l => /\/lote\//i.test(l.href));
    console.log(`  /lote/ encontrados dentro da página PAI: ${loteNoPai.length}`);
    for (const l of loteNoPai) console.log(`    ${l.href}  ("${l.texto}")`);
    console.log(`  texto visível (1000 chars): "${pai.texto.replace(/\s+/g, ' ').slice(0, 1000)}"`);
  } else {
    console.log('\n3) Nenhuma URL /leilao/ pai identificada (nem via breadcrumb do lote, nem via home) — investigar outra via.');
  }

  console.log('\n═══ FIM DO RECON');
  await browser.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
