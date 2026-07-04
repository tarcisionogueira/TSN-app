#!/usr/bin/env node
/**
 * DIAGNÓSTICO (descartável): abre algumas páginas de detalhe da Caixa no navegador
 * e imprime (a) o texto renderizado e (b) todos os links (href) — para descobrir
 * onde está a data do leilão (na página? no edital PDF?) e qual a URL do edital.
 * Rodar uma vez pelo workflow diag-cef.yml, ler o log, depois apagar.
 */
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SB, KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function amostra(modalidade, n) {
  const { data } = await supabase.from('imoveis_leilao')
    .select('id, url_lote, modalidade')
    .eq('fonte', 'CEF').eq('ativo', true).is('data_leilao', null)
    .ilike('modalidade', `%${modalidade}%`).limit(n);
  return data || [];
}

async function main() {
  const alvos = [...await amostra('extrajudicial', 3), ...await amostra('licita', 2)];
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  for (const im of alvos) {
    console.log('\n========================================');
    console.log(`ID ${im.id} · modalidade=${im.modalidade}`);
    console.log(`URL ${im.url_lote}`);
    try {
      await page.goto(im.url_lote, { waitUntil: 'networkidle2', timeout: 30000 });
      const info = await page.evaluate(() => {
        const txt = document.body?.innerText || '';
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => /pdf|edital|leilao|leiloeiro/i.test(h || ''));
        return { txt, links, len: txt.length };
      });
      console.log(`--- innerText (${info.len} chars) ---`);
      console.log(info.txt.slice(0, 2500));
      console.log('--- links (pdf/edital/leilao) ---');
      console.log(JSON.stringify([...new Set(info.links)], null, 1));
    } catch (e) {
      console.log('ERRO:', e.message);
    }
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
