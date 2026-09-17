// Dump DESCARTÁVEL — roda no runner RESIDENCIAL (IP de casa), NÃO na CI/Vercel.
//
// Continuação do teste anterior (_teste-residencial-cloudflare-bloqueados.mjs): confirmado
// que JONASLEILOEIRO e GLOBOLEILOES respondem de verdade daqui (lotes reais, valores R$
// reais). Falta ver a ESTRUTURA da página de listagem e de detalhe (rótulos, matrícula,
// PDFs, paginação) antes de escrever o parser — sem isso seria adivinhar rótulo, e é
// exatamente essa classe de erro que os parsers de origem evitam (valorPorRotulo() sobre
// texto REAL, nunca suposto). Usa Puppeteer direto (não fetch-residencial.mjs) porque
// precisa de document.body.innerText, que só existe com a página viva no navegador.
//
// Uso: node scripts/_dump-detalhe-residencial.mjs
import puppeteer from 'puppeteer';

const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function novaPagina(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  return page;
}

async function dumpListagem(browser, nome, url) {
  console.log(`\n\n══════════════════ LISTAGEM ${nome} — ${url} ══════════════════`);
  const page = await novaPagina(browser);
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('HTTP', resp ? resp.status() : '?');
    await new Promise((r) => setTimeout(r, 6000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const info = await page.evaluate(() => {
      const links = [...new Set(Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && /lote|imove|leilao|bem|detalhe/i.test(h)))];
      const cardSels = ['.card', '.lote', '[class*="lote"]', 'article', '.product', '[class*="card"]', '[class*="imovel"]'];
      const cards = {};
      for (const s of cardSels) { const n = document.querySelectorAll(s).length; if (n) cards[s] = n; }
      const pag = Array.from(document.querySelectorAll('[class*="pag"], .pagination, nav a'))
        .slice(0, 8).map((e) => (e.textContent || '').trim().slice(0, 20)).filter(Boolean);
      return { titulo: document.title, links, cards, pag };
    });
    console.log('título:', info.titulo);
    console.log('cards por seletor:', JSON.stringify(info.cards));
    console.log('paginação:', JSON.stringify(info.pag));
    console.log(`links de lote (${info.links.length}):`, JSON.stringify(info.links.slice(0, 15)));
    // 1º card com link de lote — outerHTML, pra ver a estrutura (preço/cidade/título no card).
    const cardHtml = await page.evaluate(() => {
      const arts = Array.from(document.querySelectorAll('article, [class*="card"], li, [class*="lote"]'));
      const alvo = arts.find((a) => a.querySelector('a[href*="lote"], a[href*="imove"]'));
      return alvo ? alvo.outerHTML.replace(/\s+/g, ' ').slice(0, 2200) : null;
    }).catch(() => null);
    if (cardHtml) console.log('▸ CARD outerHTML:', cardHtml);
    return info.links.map((h) => { try { return new URL(h, url).href; } catch { return null; } }).filter(Boolean);
  } catch (e) { console.log('ERRO:', e.message); return []; } finally { await page.close(); }
}

async function dumpDetalhe(browser, nome, url) {
  console.log(`\n\n══════════════════ DETALHE ${nome} — ${url} ══════════════════`);
  const page = await novaPagina(browser);
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('HTTP', resp ? resp.status() : '?');
    await new Promise((r) => setTimeout(r, 5000));
    // LOTE PODE TER EXPIRADO/SIDO REMOVIDO entre o momento em que o link foi achado (listagem)
    // e agora — o site então redireciona pra home ("Redirecionando para a página inicial..."),
    // o que destrói o contexto de execução no meio do evaluate() seguinte e mascarava a causa
    // real atrás de "Execution context was destroyed". Checa a URL final ANTES de avaliar.
    const urlFinal = page.url();
    if (urlFinal !== url && !urlFinal.startsWith(url.split('?')[0])) {
      console.log(`  ⚠️ REDIRECIONOU: ${url} → ${urlFinal} — provável lote expirado/removido; escolha outro link da listagem.`);
    }
    const texto = await page.evaluate(() => document.body.innerText || '');
    const limpo = texto.replace(/\n{2,}/g, '\n');
    console.log(`texto renderizado (${texto.length} chars) — INÍCIO:\n${limpo.slice(0, 2500)}`);
    const m = limpo.match(/avalia|lance\s*m[íi]nimo|1[ªa]?\s*pra[çc]a|matr[íi]cula/i);
    if (m && m.index > 2500) {
      const ini = Math.max(0, m.index - 200);
      console.log(`\nJANELA em volta de "${m[0]}" (pos ${m.index}):\n${limpo.slice(ini, ini + 2000)}`);
    }
    const mv = limpo.match(/R\$\s*[\d.]+,\d{2}/);
    if (mv) {
      const ini = Math.max(0, mv.index - 300);
      console.log(`\nJANELA em volta do 1º VALOR "${mv[0]}" (pos ${mv.index}):\n${limpo.slice(ini, ini + 1200)}`);
    }
    const html = await page.content();
    const docs = [...new Set((html.match(/href=["']([^"']+\.pdf[^"']*)["']/gi) || []).map((s) => (s.match(/href=["']([^"']+)["']/i) || [])[1]))];
    if (docs.length) console.log('\nPDFs no HTML:', JSON.stringify(docs.slice(0, 8)));
    const fotos = [...new Set((html.match(/<img[^>]+src=["']([^"']+)["']/gi) || []).map((s) => (s.match(/src=["']([^"']+)["']/i) || [])[1]).filter((u) => /jpe?g|png|webp/i.test(u)))];
    if (fotos.length) console.log('imagens candidatas:', JSON.stringify(fotos.slice(0, 6)));
    const ldjson = [...(html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [])].map((s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 800));
    if (ldjson.length) console.log('ld+json:', JSON.stringify(ldjson));
  } catch (e) { console.log('ERRO:', e.message); } finally { await page.close(); }
}

// Escolhe, entre os links da listagem, o melhor candidato a página de LOTE individual (não
// categoria/evento/filtro) — prefere "/lote/" explícito; senão o 1º link que não é a própria
// listagem. Autocura contra link expirado: sempre pega da rodada ATUAL, nunca hardcoded.
function escolherLote(links, urlListagem) {
  const semListagem = links.filter((l) => l !== urlListagem && !l.includes('#'));
  return semListagem.find((l) => /\/lote[-/]/i.test(l)) || semListagem[0] || null;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: BROWSER_ARGS });
  try {
    const linksJonas = await dumpListagem(browser, 'JONASLEILOEIRO', 'https://jonasleiloeiro.com.br/');
    const loteJonas = escolherLote(linksJonas, 'https://jonasleiloeiro.com.br/');
    if (loteJonas) await dumpDetalhe(browser, 'JONASLEILOEIRO', loteJonas);
    else console.log('\n(JONASLEILOEIRO: nenhum link de lote achado na listagem — pulei o detalhe)');

    const linksGlobo = await dumpListagem(browser, 'GLOBOLEILOES', 'https://globoleiloes.com.br/leiloes');
    const loteGlobo = escolherLote(linksGlobo, 'https://globoleiloes.com.br/leiloes');
    if (loteGlobo) await dumpDetalhe(browser, 'GLOBOLEILOES', loteGlobo);
    else console.log('\n(GLOBOLEILOES: nenhum link de lote achado na listagem — pulei o detalhe)');

    const linksFernando = await dumpListagem(browser, 'FERNANDOLEILOEIRO', 'https://fernandoleiloeiro.com.br/');
    const loteFernando = escolherLote(linksFernando, 'https://fernandoleiloeiro.com.br/');
    if (loteFernando) await dumpDetalhe(browser, 'FERNANDOLEILOEIRO', loteFernando);
    else console.log('\n(FERNANDOLEILOEIRO: nenhum link de lote achado na listagem — pulei o detalhe)');
  } finally {
    await browser.close();
  }
  console.log('\n\n✅ dump concluído.');
})();
