// TEMPORÁRIO — recon do ALBERTOMACEDOLEILOES: o dono reportou que
// https://www.albertomacedoleiloes.com.br/lote/2-lote-residencial-buri-residence não aparece
// no sistema mesmo com o scraper configurado. Leitura de código (scripts/lib/albertomacedo-
// parse.mjs) mostrou que extrairUrlsDeLote só reconhece /leilao/<slug> — /lote/N-slug é
// estruturalmente invisível pro parser atual. Tentativa 1 (fetch cru) voltou 403 em TUDO —
// cf-mitigated=challenge, corpo "Just a moment..." — Cloudflare JS-challenge, não dá pra ler
// sem JS de verdade. Isso NÃO prova que o scraper de produção está bloqueado (ele usa Puppeteer
// headless real via criarMotorDom, que executa JS — e o fonte tem 3 imóveis ativos atualizados
// hoje). Este recon usa Puppeteer headless igual à produção pra: (a) confirmar se a URL do lote
// é real e dissectar os campos, (b) achar de onde /lote/ é linkado (home direto, ou só dentro
// de página /leilao/<slug> pacote).
import puppeteer from 'puppeteer';

const BASE = 'https://www.albertomacedoleiloes.com.br';
const LOTE_URL = process.env.LOTE_URL || `${BASE}/lote/2-lote-residencial-buri-residence`;

async function abrir(page, url, espera = 4000) {
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) {
    console.log(`    erro ao navegar: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, espera));
  const html = await page.content();
  const texto = await page.evaluate(() => document.body.innerText);
  return { status, html, texto };
}

function linksInternos(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.host.includes('albertomacedoleiloes.com.br')) out.set(u.pathname, u.href);
    } catch { /* skip */ }
  }
  return [...out.values()];
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log(`🔎 RECON HEADLESS — ALBERTOMACEDOLEILOES /lote/ vs /leilao/\n`);

  console.log(`1) Abrindo direto a URL do lote reportada: ${LOTE_URL}`);
  const det = await abrir(page, LOTE_URL);
  console.log(`  status: ${det.status} · html: ${det.html.length} chars · texto visível: ${det.texto.length} chars`);
  const challenge = /just a moment|cf-browser-verification|checking your browser|attention required/i.test(det.html);
  console.log(`  ainda em challenge Cloudflare após JS? ${challenge}`);
  if (!challenge && det.texto.length > 200) {
    console.log(`  texto visível (1500 chars): "${det.texto.replace(/\s+/g, ' ').slice(0, 1500)}"`);
    console.log(`  tem "Avaliação"? ${/Avalia[çc][ãa]o/i.test(det.texto)}`);
    console.log(`  tem "matrícula"? ${/matr[íi]cula/i.test(det.texto)}`);
    console.log(`  tem tabela de praça? ${/pra[çc]a/i.test(det.texto)}`);
    const pdfs = [...det.html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]);
    console.log(`  PDFs no HTML: ${pdfs.length}`);
    for (const p of pdfs.slice(0, 5)) console.log(`    ${p}`);
  }

  console.log(`\n2) Abrindo a HOME (${BASE}/) — /lote/ aparece linkado direto?`);
  const home = await abrir(page, `${BASE}/`);
  console.log(`  status: ${home.status} · html: ${home.html.length} chars · texto visível: ${home.texto.length} chars`);
  const challengeHome = /just a moment|cf-browser-verification|checking your browser/i.test(home.html);
  console.log(`  ainda em challenge Cloudflare após JS? ${challengeHome}`);
  const linksHome = linksInternos(home.html, BASE);
  const loteNaHome = linksHome.filter(u => /\/lote\//i.test(u));
  const leilaoNaHome = linksHome.filter(u => /\/leilao\//i.test(u));
  console.log(`  ${linksHome.length} links internos (via regex no HTML pós-JS) · ${loteNaHome.length} com /lote/ · ${leilaoNaHome.length} com /leilao/`);
  for (const l of loteNaHome.slice(0, 10)) console.log(`    /lote/: ${l}`);
  for (const l of leilaoNaHome.slice(0, 10)) console.log(`    /leilao/: ${l}`);

  // Também via $$eval, caso o regex no HTML perca algo montado só no DOM.
  const anchorsHome = await page.$$eval('a', as => as.map(a => a.getAttribute('href') || '').filter(Boolean)).catch(() => []);
  const loteAnchors = anchorsHome.filter(h => /\/lote\//i.test(h));
  console.log(`  via DOM $$eval: ${anchorsHome.length} <a> total · ${loteAnchors.length} com /lote/`);
  for (const l of loteAnchors.slice(0, 10)) console.log(`    DOM /lote/: ${l}`);

  const candidatoPacote = leilaoNaHome.find(u => /buri/i.test(u)) || leilaoNaHome[0];
  if (candidatoPacote) {
    console.log(`\n3) Abrindo candidato a página PACOTE: ${candidatoPacote}`);
    const pac = await abrir(page, candidatoPacote);
    console.log(`  status: ${pac.status} · html: ${pac.html.length} chars`);
    const linksPacote = linksInternos(pac.html, BASE);
    const loteNoPacote = linksPacote.filter(u => /\/lote\//i.test(u));
    console.log(`  /lote/ encontrados DENTRO desta página pacote: ${loteNoPacote.length}`);
    for (const l of loteNoPacote.slice(0, 15)) console.log(`    ${l}`);
  } else {
    console.log('\n3) Nenhum /leilao/ encontrado na home pra testar como pacote.');
  }

  console.log('\n═══ FIM DO RECON');
  await browser.close();
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
