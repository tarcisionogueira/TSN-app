#!/usr/bin/env node
/**
 * EXPLORAR FRAZÃO — garimpo diagnóstico (não altera nada no banco).
 *
 * Objetivo: descobrir dados que o scraper atual NÃO captura:
 *  - se há uma API JSON por trás (respostas ricas por lote: avaliação, área,
 *    ocupação, matrícula, edital, débitos, processo);
 *  - atributos data-* dos cards de lote;
 *  - campos da PÁGINA DE DETALHE de um lote (rótulos/valores, PDFs, palavras-chave).
 *
 * Uso: node scripts/explorar-frazao.mjs
 * Opcional: FRAZAO_MAX_LEILOES (default 2), PW_CHROMIUM (executablePath).
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.frazaoleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAXL = parseInt(process.env.FRAZAO_MAX_LEILOES || '2', 10);
const trunc = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function lançar() {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] };
  if (process.env.PW_CHROMIUM) opts.executablePath = process.env.PW_CHROMIUM;
  try { return await puppeteer.launch(opts); }
  catch (e) { opts.executablePath = '/opt/pw-browsers/chromium'; return await puppeteer.launch(opts); }
}

async function main() {
  const browser = await lançar();
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  // 1) Captura respostas JSON/XHR (possível API rica).
  const apis = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      const url = resp.url();
      if (!/json/i.test(ct)) return;
      if (/google|analytics|gtm|facebook|hotjar|clarity/i.test(url)) return;
      let body = null;
      try { body = await resp.json(); } catch { return; }
      const amostraChaves = Array.isArray(body) ? (body[0] ? Object.keys(body[0]) : []) : Object.keys(body || {});
      apis.push({ url, status: resp.status(), tipoRaiz: Array.isArray(body) ? `array[${body.length}]` : typeof body, chaves: amostraChaves.slice(0, 40) });
    } catch { /* ignora */ }
  });

  console.log('== 1) HOME ==');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });

  // 2) Estrutura do card do lote + TODOS os data-* do <a> e do container.
  const cardInfo = await page.evaluate(() => {
    const a = document.querySelector('a.visualizar_lote[data-lote-id]');
    if (!a) return { achou: false };
    const dataAttrs = {};
    for (const at of a.attributes) if (at.name.startsWith('data-')) dataAttrs[at.name] = at.value.slice(0, 120);
    let card = a;
    for (let i = 0; i < 5 && card && !(card.querySelector && card.querySelector('.lot-info')); i++) card = card.parentElement;
    return { achou: true, dataAttrs, cardHTML: (card || a).outerHTML.slice(0, 1500), href: a.getAttribute('href') };
  });
  console.log('data-* do card:', JSON.stringify(cardInfo.dataAttrs || {}, null, 2));
  console.log('href do lote:', cardInfo.href);
  console.log('HTML do card (trecho):', trunc(cardInfo.cardHTML, 900));

  // 3) JSON embutido no HTML (window.__DATA__, __NUXT__, application/json).
  const embutidos = await page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      if (s.type === 'application/json' && t.length > 50) out.push({ tipo: 'application/json', tam: t.length, amostra: t.slice(0, 200) });
      const m = t.match(/(window\.__[A-Z_]+__|var\s+lotes|const\s+lotes|"lotes"\s*:)/);
      if (m) out.push({ tipo: 'js-embutido', marcador: m[1], amostra: t.slice(0, 200) });
    }
    return out.slice(0, 8);
  });
  console.log('\n== JSON/estado embutido no HTML ==');
  console.log(embutidos.length ? JSON.stringify(embutidos, null, 2) : '(nenhum)');

  // 4) Página de DETALHE de um lote: rótulos/valores + PDFs + palavras-chave.
  const detalheUrl = cardInfo.href ? (cardInfo.href.startsWith('http') ? cardInfo.href : BASE + cardInfo.href) : null;
  if (detalheUrl) {
    console.log('\n== 4) DETALHE:', detalheUrl, '==');
    await page.goto(detalheUrl.split('?')[0], { waitUntil: 'networkidle2', timeout: 60000 });
    const det = await page.evaluate(() => {
      const texto = (document.body.innerText || '').replace(/\r/g, '');
      const acha = (re) => { const m = texto.match(re); return m ? m[0].replace(/\s+/g, ' ').trim().slice(0, 120) : null; };
      const pdfs = [...document.querySelectorAll('a[href$=".pdf"], a[href*="edital"], a[href*="matricula"]')].map(a => a.href).slice(0, 15);
      // pares rótulo→valor de tabelas/dl
      const pares = [];
      for (const row of document.querySelectorAll('tr, .row, dl > *, li')) {
        const t = (row.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 90 && /:/.test(t)) pares.push(t);
      }
      return {
        avaliacao: acha(/avalia[çc][ãa]o[^R]{0,20}R\$\s*[\d.,]+/i),
        area: acha(/[\d.,]+\s*m²|[áa]rea[^\d]{0,20}[\d.,]+/i),
        ocupacao: acha(/(desocupad|ocupad)[a-z]*/i),
        matricula: acha(/matr[íi]cula[^\d]{0,10}[\d.\/-]+/i),
        processo: acha(/processo[^\d]{0,10}[\d.\-\/]+/i),
        segundoLeilao: acha(/2[ºo]\s*(leil[ãa]o|pra[çc]a)[^\d]{0,20}\d{2}\/\d{2}\/\d{4}/i),
        pdfs,
        paresAmostra: pares.slice(0, 25),
      };
    });
    console.log(JSON.stringify(det, null, 2));
  }

  // 5) Relatório de APIs JSON vistas.
  console.log('\n== 5) APIs JSON observadas (candidatas a fonte rica) ==');
  const vistas = new Map();
  for (const a of apis) { const k = a.url.split('?')[0]; if (!vistas.has(k)) vistas.set(k, a); }
  console.log(vistas.size ? JSON.stringify([...vistas.values()], null, 2) : '(nenhuma resposta JSON — site é server-rendered)');

  await browser.close();
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
