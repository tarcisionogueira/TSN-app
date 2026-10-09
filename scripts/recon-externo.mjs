/**
 * Recon PONTUAL (09/10, #38) — plataforma "/externo/" (osvaldo, sanches, são caetano, delano,
 * judhastas, hisa). A página do leilão (/externo/leilao/<id>) vem do servidor com o imóvel no título,
 * mas os LOTES não aparecem no HTML cru (pg_net). Aqui, num navegador real: (1) toda chamada
 * XHR/fetch que a página faz, com amostra da resposta; (2) links de lote no DOM final; (3) a página de
 * um lote — campos visíveis (avaliação, lance, praças, endereço, matrícula, fotos, anexos).
 * NÃO grava nada — só imprime.
 */
import puppeteer from 'puppeteer';

const ALVOS = [
  'https://www.osvaldoleiloes.com.br/externo/leilao/2252',
  'https://www.sanchesleiloes.com.br/externo/leilao/2255',
  'https://www.osvaldoleiloes.com.br/externo/',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const limpa = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
let loteAberto = false;
for (const url of ALVOS) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const chamadas = [];
  page.on('response', async (r) => {
    const tipo = r.request().resourceType();
    if (!['xhr', 'fetch', 'document'].includes(tipo)) return;
    try {
      const t = await r.text();
      chamadas.push({ tipo, metodo: r.request().method(), url: r.url(), st: r.status(), post: limpa(r.request().postData(), 200), n: t.length, amostra: limpa(t, 500) });
    } catch { /* corpo indisponível (redirect) — recon, segue */ }
  });
  console.log(`\n\n════════ ${url} ════════`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`  título: ${await page.title()}`);
    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /\/externo\/(lote|bem|bens\/|leilao\/)/i.test(h)))]);
    console.log(`  links lote/leilão no DOM (${links.length}):`); links.slice(0, 25).forEach((l) => console.log(`   ${l}`));
    const cards = await page.evaluate(() => [...document.querySelectorAll('[class*=lote], [class*=card], [class*=bem]')].slice(0, 6).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)} :: ${e.innerText.replace(/\s+/g, ' ').slice(0, 220)}`));
    console.log('  cards:'); cards.forEach((c) => console.log(`   ${c}`));
    console.log(`  chamadas (${chamadas.length}):`);
    chamadas.filter((c) => c.tipo !== 'document' || c.url !== url).slice(0, 20).forEach((c) => console.log(`   [${c.tipo} ${c.metodo} ${c.st}] ${c.url} ${c.post ? `body=${c.post}` : ''} (${c.n}b) ${c.amostra}`));
    const loteUrl = links.find((l) => /\/externo\/(lote|bem)\//i.test(l));
    if (loteUrl && !loteAberto) {
      loteAberto = true;
      const p2 = await browser.newPage(); await p2.setUserAgent(UA);
      const ch2 = [];
      p2.on('response', async (r) => { const t = r.request().resourceType(); if (!['xhr', 'fetch'].includes(t)) return; try { const x = await r.text(); ch2.push(`[${r.request().method()} ${r.status()}] ${r.url()} (${x.length}b) ${limpa(x, 300)}`); } catch { /* recon */ } });
      await p2.goto(loteUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 3000));
      console.log(`\n  ── LOTE ${loteUrl}`);
      console.log(`  texto: ${limpa(await p2.evaluate(() => document.body.innerText), 2500)}`);
      const imgs = await p2.evaluate(() => [...new Set([...document.querySelectorAll('img')].map((i) => i.src).filter((s) => /^https?:/.test(s)))].slice(0, 15));
      console.log(`  imagens: ${imgs.join(' ')}`);
      const anexos = await p2.evaluate(() => [...document.querySelectorAll('a[href], [data-href]')].map((a) => `${a.innerText.trim().slice(0, 40)} -> ${a.getAttribute('href') || a.getAttribute('data-href')}`).filter((s) => /pdf|arquivo|anexo|edital|matr|laudo/i.test(s)).slice(0, 15));
      console.log(`  anexos/links doc: ${anexos.join(' | ')}`);
      console.log(`  xhr do lote: ${ch2.join('\n   ')}`);
      const html = await p2.content();
      console.log(`  html (trecho com 'avalia'): ${limpa(html.slice(Math.max(0, html.search(/avalia/i) - 300), html.search(/avalia/i) + 900), 1200)}`);
      await p2.close();
    }
  } catch (e) { console.log(`  ERRO: ${e.message}`); }
  await page.close();
}
await browser.close();
