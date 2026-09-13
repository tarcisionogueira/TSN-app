#!/usr/bin/env node
/**
 * RECON — por que o scroll infinito do LJUD para em ~42 cards contra os ~570 anunciados
 * na página (HANDOFF 13/09, pendência #8)? Hipótese a testar: a lista é VIRTUALIZADA (o
 * React remove cards antigos do DOM conforme novos entram) — nesse caso, extrair
 * `.base-card` só UMA VEZ no final (como o scraper faz hoje) só pega o que sobrou visível,
 * não o total já visto. Para confirmar: em cada passo de scroll, registra o SET de hrefs
 * visíveis; se o total ACUMULADO (união de todos os sets) crescer bem além do que qualquer
 * snapshot individual mostra, é virtualização — e a correção é acumular DURANTE o scroll,
 * não extrair no fim. Só leitura, não grava nada.
 *
 * Uso: node scripts/recon-ljud-scroll-virtualizacao.mjs
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  try {
    await page.goto('https://www.leiloesjudiciais.com.br/veiculos/carros', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2000));

    // Total anunciado na própria página (texto tipo "570 resultados", se existir).
    const totalTexto = await page.evaluate(() => {
      const m = document.body.textContent.match(/(\d{2,5})\s*(?:resultados|ve[íi]culos|itens|carros)\b/i);
      return m ? m[0] : null;
    });
    console.log(`Texto de total anunciado: ${totalTexto || '(não achado)'}`);

    const acumulado = new Set();
    let prevSnapshot = 0;
    for (let i = 0; i < 60; i++) {
      const hrefs = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return [...document.querySelectorAll('.base-card a[href]')].map((a) => a.href);
      });
      await new Promise((r) => setTimeout(r, 1600));
      const antes = acumulado.size;
      for (const h of hrefs) acumulado.add(h);
      if (i % 5 === 0 || acumulado.size !== antes) {
        console.log(`  passo ${i}: snapshot=${hrefs.length} cards visíveis | acumulado_total=${acumulado.size} (novos: ${acumulado.size - antes})`);
      }
      if (acumulado.size === antes && hrefs.length === prevSnapshot && i > 10) {
        console.log(`  parou de crescer no passo ${i} (snapshot estável em ${hrefs.length}, acumulado parado em ${acumulado.size})`);
        break;
      }
      prevSnapshot = hrefs.length;
    }
    console.log(`\nTOTAL ACUMULADO (união de todos os snapshots): ${acumulado.size}`);
    console.log(`ÚLTIMO SNAPSHOT (o que o extrator atual pegaria, extraindo só no fim): ${prevSnapshot}`);
    console.log(acumulado.size > prevSnapshot * 1.3
      ? '=> VIRTUALIZAÇÃO CONFIRMADA: o acumulado é bem maior que qualquer snapshot — extrair só no fim perde a maioria.'
      : '=> Sem sinal forte de virtualização — o scroll pode estar simplesmente parando de carregar (outro mecanismo).');
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
