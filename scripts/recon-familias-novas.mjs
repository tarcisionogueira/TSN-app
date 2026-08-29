/**
 * RECON DAS 3 FAMÍLIAS NOVAS DA JUCEMG (item 7, 29/08). NÃO GRAVA NADA.
 *
 * A triagem agrupou 12 sites em três plataformas que ainda não parseamos:
 *   · `leiloesjudiciais`      — 7 sites (compartilham atendimento.leiloesjudiciais.com.br)
 *   · `leilao.pro`            — 3 sites (js.pusher.com + cdn.onesignal.com + www.leilao.pro)
 *   · `suaplataformadeleilao` — 2 sites
 * Um parser por família serve o grupo inteiro — foi assim que SOLEON virou 4 fontes e a
 * família Superbid, outras 4.
 *
 * ⚠️ A LIÇÃO DO ITEM 6, QUE ESTE SCRIPT EXISTE PARA NÃO REPETIR. Naquele caso 11 sites foram
 * classificados como Superbid porque o HTML deles continha `/busca/segmento/` — e no dry-run os
 * 11 enumeraram ZERO lotes. Um leiloeiro que LINKA para uma plataforma carrega o caminho dela
 * sem RODAR a plataforma. Por isso aqui o critério não é "menciona": é **achou lote de imóvel
 * com preço**. Enquanto o recon não vir lote, a família não vira parser.
 *
 * Estratégia por site: home → lista os links que parecem catálogo → abre o mais promissor →
 * conta cartões com preço e despeja dois. Duas páginas por site, acesso grátis.
 */
import puppeteer from 'puppeteer';

const FAMILIAS = [
  { familia: 'leiloesjudiciais', sites: ['https://www.rioleiloes.com.br', 'https://www.diasleiloes.com.br'] },
  { familia: 'leilao.pro',       sites: ['https://www.ileiloes.com.br', 'https://www.versallesleiloes.com.br'] },
  { familia: 'suaplataforma',    sites: ['https://www.andraleiloes.com.br', 'https://www.jinkingsleiloes.com.br'] },
];
const RE_CATALOGO = /im[óo]ve|leil[õo]es|busca|lotes|catalog|oportunidade|agenda/i;
const RE_PRECO = /R\$\s?[\d.]{3,}/;

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

for (const f of FAMILIAS) {
  console.log(`\n${'#'.repeat(72)}\nFAMÍLIA ${f.familia}`);
  for (const site of f.sites) {
    console.log(`\n--- ${site}`);
    const page = await browser.newPage();
    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
      const r = await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 40000 });
      console.log(`  home HTTP ${r?.status()}`);
      await new Promise(x => setTimeout(x, 2500));

      const links = await page.evaluate((re) => {
        const rx = new RegExp(re, 'i');
        const vistos = new Map();
        for (const el of document.querySelectorAll('a[href]')) {
          const href = el.getAttribute('href') || '';
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!href || href.startsWith('#') || /mailto:|tel:|whatsapp|facebook|instagram/i.test(href)) continue;
          if (!rx.test(`${txt} ${href}`)) continue;
          if (!vistos.has(href)) vistos.set(href, txt.slice(0, 40));
        }
        return [...vistos.entries()].slice(0, 14).map(([h, t]) => `${t || '(sem texto)'} → ${h}`);
      }, RE_CATALOGO.source);
      console.log(`  candidatos a catálogo:\n   ${links.join('\n   ') || '(nenhum)'}`);

      // Abre o primeiro candidato que pareça catálogo de IMÓVEL.
      const alvo = links.find(l => /im[óo]ve/i.test(l)) || links[0];
      if (!alvo) { console.log('  sem candidato — nada a abrir'); continue; }
      const href = alvo.split('→').pop().trim();
      const url = href.startsWith('http') ? href : new URL(href, site).toString();
      console.log(`  abrindo catálogo: ${url}`);
      const r2 = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      console.log(`  catálogo HTTP ${r2?.status()} · url final ${page.url()}`);
      await new Promise(x => setTimeout(x, 3000));

      const achado = await page.evaluate((rePreco) => {
        const rx = new RegExp(rePreco);
        const todos = [...document.querySelectorAll('article, li, div[class*="card"], div[class*="lote"], div[class*="item"]')];
        const cards = todos.filter(el => rx.test(el.textContent || '') && (el.textContent || '').length < 2500);
        cards.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return {
          total: cards.length,
          amostra: cards.slice(0, 2).map(el => ({
            classe: el.className || '(sem classe)',
            texto: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
            link: (el.querySelector('a[href]') || {}).getAttribute?.('href') || '(sem link)',
            html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 900),
          })),
        };
      }, RE_PRECO.source);

      // ⚠️ ESTE é o número que decide, e não a assinatura da plataforma.
      console.log(`  >>> LOTES COM PREÇO NO CATÁLOGO: ${achado.total} ${achado.total ? '' : '(família NÃO confirmada — não vira parser)'}`);
      for (const [i, c] of achado.amostra.entries()) {
        console.log(`  card ${i + 1} class="${String(c.classe).slice(0, 60)}" link=${c.link}`);
        console.log(`    TEXTO: ${c.texto}`);
        console.log(`    HTML : ${c.html}`);
      }
    } catch (e) {
      console.log(`  ERRO: ${String(e?.message || e).slice(0, 180)}`);
    } finally { await page.close().catch(() => {}); }
  }
}
await browser.close();
