/**
 * Recon PONTUAL (11/09) — NORDESTE/SIMONLEILOES seguem em 0% foto (HANDOFF, pendência 6)
 * mesmo com o fix de srcset em fotoDeHtml() (dom-parse-util.mjs). Hipótese a checar contra
 * dado real: se for Next.js (NORDESTE é App Router, confirmado), a imagem pode passar pelo
 * proxy de otimização `/_next/image?url=...&w=...`, cujo `src` NÃO termina em .jpg/.png/.webp
 * (termina em "&q=75" ou similar) — o filtro de extensão de fotoDeHtml() descartaria isso
 * mesmo achando o <img> certo. Não editar o parser sem ver o HTML real primeiro (mesma lição
 * já registrada 2x pra estas duas fontes: não adivinhar de novo).
 *
 * NÃO grava nada — só imprime todo <img> da página renderizada (src/srcset/class/dimensões).
 */
import puppeteer from 'puppeteer';

const ALVOS = [
  { fonte: 'NORDESTE', url: 'https://www.nordesteleiloes.com.br/lotes/196-001-50-do-apartamento-localizado-no-edif-residencial-ilha-de-capri-imbui-salvadorba' },
  { fonte: 'SIMONLEILOES', url: 'https://simonleiloes.com.br/lotes/imovel-urbano-curitiba-pr-nucleo-de-hastas-publicas-de-curitiba-pr-n3-12982' },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

for (const { fonte, url } of ALVOS) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  console.log(`\n\n════════ ${fonte} — ${url} ════════`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000)); // deixa lazy-load/hydration completar
    const imgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img')].map(img => ({
        src: img.getAttribute('src'),
        srcset: img.getAttribute('srcset'),
        dataSrc: img.getAttribute('data-src'),
        classe: img.getAttribute('class'),
        w: img.naturalWidth || img.width, h: img.naturalHeight || img.height,
        loading: img.getAttribute('loading'),
      }));
    });
    console.log(`  ${imgs.length} <img> encontradas após render:`);
    imgs.slice(0, 25).forEach((im, i) => console.log(`   [${i}] src=${im.src} | srcset=${(im.srcset || '').slice(0, 140)} | data-src=${im.dataSrc} | class="${im.classe}" | ${im.w}x${im.h} | loading=${im.loading}`));
    // Também procura background-image inline (CSS), caso a foto não seja <img> de verdade.
    const bgs = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[style*="background"]').forEach(el => {
        const s = el.getAttribute('style') || '';
        if (/background-image/i.test(s)) out.push(s.slice(0, 200));
      });
      return out.slice(0, 10);
    });
    if (bgs.length) { console.log(`  ${bgs.length} elemento(s) com background-image inline:`); bgs.forEach(b => console.log(`   ${b}`)); }
  } catch (e) {
    console.log(`  erro: ${String(e.message).slice(0, 200)}`);
  } finally {
    await page.close();
  }
}

await browser.close();
