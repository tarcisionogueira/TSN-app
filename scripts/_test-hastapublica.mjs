#!/usr/bin/env node
/**
 * TESTE (18/09) — roda só o coletor da HastaPública, isolado, SEM gravar no banco. Imprime
 * os imóveis mapeados pra conferir a extração (título, cidade/UF, valor, data, filtro de
 * imóvel×veículo) contra dado real antes de deixar o coletor entrar na rodada diária —
 * mesma disciplina de "nunca escrever parser às cegas" já documentada no HANDOFF.
 */
import puppeteer from 'puppeteer';
import { scraperHastaPublica } from './scraper-puppeteer.mjs';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const imoveis = await scraperHastaPublica(browser);
    console.log(`\n=== ${imoveis.length} imóveis mapeados ===`);
    for (const im of imoveis.slice(0, 30)) {
      console.log(`- [${im.fonte_id}] ${im.titulo} | ${im.cidade}/${im.estado} | R$ ${im.valor_minimo} | ${im.modalidade} | leilão: ${im.data_leilao} | ${im.link_edital}`);
    }
    if (imoveis.length > 30) console.log(`  ... e mais ${imoveis.length - 30}`);
  } finally {
    await browser.close();
  }
})();
