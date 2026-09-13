#!/usr/bin/env node
/**
 * RECON — o scroll do LJUD trava em EXATAMENTE 42 cards desde o 1º passo (recon anterior
 * já descartou virtualização: não é "acumula e esquece", é "nunca carrega mais"). Hipótese
 * seguinte: o gatilho de carregar-mais escuta um CONTÊINER INTERNO com scroll próprio
 * (`overflow: auto/scroll`), não a janela — `window.scrollTo` no body não move esse
 * contêiner, e o observer de "carregar mais" nunca dispara. Este script acha esse contêiner
 * (maior `scrollHeight - clientHeight` entre os elementos com overflow visível) e rola ELE,
 * em vez da janela. Também intercepta requisições de rede durante a tentativa, pra confirmar
 * se algum XHR chega a disparar. Só leitura, não grava nada.
 *
 * Uso: node scripts/recon-ljud-scroll-container.mjs
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const xhrs = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/api\.leiloesjudiciais|get-bens|get-lotes|\/api\//i.test(url)) xhrs.push({ t: Date.now(), url, method: req.method() });
  });

  try {
    await page.goto('https://www.leiloesjudiciais.com.br/veiculos/carros', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2000));

    const containers = await page.evaluate(() => {
      const cands = [];
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        const scrollável = /(auto|scroll)/.test(cs.overflowY);
        const folga = el.scrollHeight - el.clientHeight;
        if (scrollável && folga > 50 && el.querySelectorAll('.base-card').length > 0) {
          cands.push({
            tag: el.tagName, cls: (el.className || '').toString().slice(0, 80),
            scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, folga,
            cards: el.querySelectorAll('.base-card').length,
          });
        }
      });
      return cands.sort((a, b) => b.folga - a.folga).slice(0, 5);
    });
    console.log('Contêineres candidatos (overflow scroll/auto, com .base-card dentro):');
    console.log(JSON.stringify(containers, null, 2));

    // Botão "carregar mais" / "ver mais" escondido no DOM (mesmo sem estar visível)?
    const botaoMais = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const m = els.find((e) => /carregar mais|ver mais|mostrar mais|load more/i.test(e.textContent || ''));
      return m ? { tag: m.tagName, texto: (m.textContent || '').trim().slice(0, 60), visivel: !!(m.offsetWidth || m.offsetHeight) } : null;
    });
    console.log(`\nBotão "carregar mais" no DOM: ${botaoMais ? JSON.stringify(botaoMais) : '(nenhum achado)'}`);

    // Tenta rolar o MAIOR contêiner interno (se achou algum) em vez da janela.
    if (containers.length) {
      const antesXhr = xhrs.length;
      for (let i = 0; i < 15; i++) {
        await page.evaluate((cls) => {
          const el = [...document.querySelectorAll('*')].find((e) => (e.className || '').toString().slice(0, 80) === cls);
          if (el) el.scrollTop = el.scrollHeight;
        }, containers[0].cls);
        await new Promise((r) => setTimeout(r, 1200));
      }
      const cardsDepois = await page.evaluate(() => document.querySelectorAll('.base-card').length);
      console.log(`\nApós rolar o contêiner interno 15x: ${cardsDepois} cards (XHRs novos: ${xhrs.length - antesXhr})`);
    } else {
      console.log('\nNenhum contêiner interno com scroll próprio encontrado — o problema não é esse.');
    }

    console.log(`\nTotal de requisições XHR relevantes capturadas na sessão inteira: ${xhrs.length}`);
    xhrs.slice(0, 10).forEach((x) => console.log(`  ${x.method} ${x.url}`));
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
