// TEMPORÁRIO — rodada 2: a rodada 1 achou o motivo do descarte (valor_avaliacao=0), agora
// dissecta o texto ao redor de "Avalia" e a tabela de praças pra achar o formato real.
import puppeteer from 'puppeteer';
import { textoDe, linhasDeTabela } from './lib/dom-parse-util.mjs';

const URLS = [
  'https://www.albertomacedoleiloes.com.br/lote/2-lote-residencial-buri-residence',
];

async function abrirIsolado(browser, url) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { console.log(`  erro: ${e.message}`); }
  await new Promise(r => setTimeout(r, 3000));
  const html = await page.content();
  await ctx.close();
  return html;
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const url of URLS) {
    console.log(`\n### ${url}`);
    const html = await abrirIsolado(browser, url);
    const txt = textoDe(html);
    const idx = txt.search(/Avalia[çc][ãa]o/i);
    console.log('idx de "Avalia":', idx);
    if (idx >= 0) console.log('contexto (200 chars):', JSON.stringify(txt.slice(Math.max(0, idx - 30), idx + 170)));
    const linhas = linhasDeTabela(html);
    console.log('linhasDeTabela: total', linhas.length);
    for (const l of linhas.slice(0, 10)) console.log('  linha:', JSON.stringify(l));
    // procura QUALQUER "R$" no texto pra ver o formato real
    const rs = [...txt.matchAll(/R\$\s*[\d.,]+/g)].map(m => m[0]);
    console.log('todas ocorrências de R$ no texto:', JSON.stringify(rs));
  }
  await browser.close();
  console.log('\n═══ FIM');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
