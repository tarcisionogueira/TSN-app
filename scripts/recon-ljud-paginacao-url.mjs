#!/usr/bin/env node
/**
 * RECON — LJUD /veiculos/carros é 100% server-rendered, SEM XHR e SEM botão "carregar
 * mais" visível (confirmado nos recons anteriores desta sessão e no HANDOFF de 13/09).
 * Hipótese que sobrou: paginação por QUERY STRING na própria URL (`?pagina=2`, `?page=2`
 * etc.) — página com link/formulário de paginação tradicional, não scroll infinito.
 * Busca qualquer padrão de paginação no HTML (href com "pagina="/"page="/números soltos
 * de paginação) e testa `?pagina=2` direto para ver se os IDs de lote mudam. Só leitura.
 *
 * Uso: node scripts/recon-ljud-paginacao-url.mjs
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const BASE = 'https://www.leiloesjudiciais.com.br/veiculos/carros';

async function idsDaPagina(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));
  return page.evaluate(() => {
    const paginaLinks = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => /p[aá]gina|page=|\/p\/\d+|\?p=/i.test(h || ''));
    const ids = [...document.querySelectorAll('.base-card a[href]')]
      .map((a) => (a.href.match(/\/lote\/(\d+)\/(\d+)/) || [])[2])
      .filter(Boolean);
    return { paginaLinksAmostra: [...new Set(paginaLinks)].slice(0, 10), totalCards: ids.length, ids };
  });
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  try {
    console.log('── Página base (sem parâmetro) ──');
    const p1 = await idsDaPagina(page, BASE);
    console.log(`  cards: ${p1.totalCards} | links de paginação encontrados no HTML: ${JSON.stringify(p1.paginaLinksAmostra)}`);
    console.log(`  primeiros IDs: ${p1.ids.slice(0, 5).join(', ')}`);

    for (const qs of ['?pagina=2', '?page=2', '?p=2']) {
      console.log(`\n── Tentando ${qs} ──`);
      const p2 = await idsDaPagina(page, `${BASE}${qs}`);
      const novos = p2.ids.filter((id) => !p1.ids.includes(id));
      console.log(`  cards: ${p2.totalCards} | IDs diferentes da página base: ${novos.length} de ${p2.ids.length}`);
      console.log(`  primeiros IDs: ${p2.ids.slice(0, 5).join(', ')}`);
    }
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
