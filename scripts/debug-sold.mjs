/**
 * Captura de diagnóstico do Sold Leilões (JS-heavy / jQuery + XHR).
 * Objetivo: descobrir a API interna que lista os lotes e a estrutura do DOM
 * renderizado, gravando tudo em debug_fetch para inspeção via Supabase.
 *
 * Não grava em imoveis_leilao. Rodar via workflow debug-sold.yml.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function gravarDebug(fonte, url, status, contentType, conteudo) {
  const txt = String(conteudo || '').slice(0, 400000);
  const { error } = await supabase.from('debug_fetch').insert({
    fonte, url, status, content_type: contentType, via: 'puppeteer', conteudo: txt,
  });
  if (error) console.log(`  erro gravarDebug ${fonte}: ${error.message}`);
  else console.log(`  gravado debug ${fonte} (${txt.length} chars) ${url.slice(0, 90)}`);
}

async function main() {
  console.log('🔎 Debug Sold —', new Date().toISOString());
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const xhrs = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const ct = resp.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const text = await resp.text();
      if (text.length < 80) return;
      xhrs.push({ url, ct, status: resp.status(), text });
    } catch {}
  });

  const alvo = 'https://www.sold.com.br/leiloes-de-imoveis';
  console.log('  navegando para', alvo);
  try {
    await page.goto(alvo, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch (e) {
    console.log('  goto falhou:', e.message.slice(0, 80));
  }
  // espera render dos cards e XHRs tardios
  await new Promise(r => setTimeout(r, 6000));

  // 1) DOM renderizado
  const html = await page.content();
  await gravarDebug('SOLD-render', alvo, 200, 'text/html', html);

  // 2) Resumo dos XHRs JSON capturados
  xhrs.sort((a, b) => b.text.length - a.text.length);
  const resumo = xhrs.map(x => `${x.status} ${x.text.length}b ${x.ct}\n${x.url}`).join('\n\n');
  await gravarDebug('SOLD-xhr-list', alvo, 200, 'text/plain', resumo || '(nenhum JSON capturado)');
  console.log(`  XHRs JSON capturados: ${xhrs.length}`);
  xhrs.slice(0, 8).forEach(x => console.log(`    ${x.text.length}b  ${x.url.slice(0, 110)}`));

  // 3) Os 3 maiores JSON (provavelmente a listagem de lotes)
  for (let i = 0; i < Math.min(3, xhrs.length); i++) {
    await gravarDebug(`SOLD-xhr-${i + 1}`, xhrs[i].url, xhrs[i].status, xhrs[i].ct, xhrs[i].text);
  }

  // 4) Amostra de seletores candidatos no DOM renderizado
  const domStats = await page.evaluate(() => {
    const sel = {};
    ['[class*="card"]', '[class*="lot"]', '[class*="auction"]', '[class*="product"]', 'article', '[data-id]', 'a[href*="/lote"]', 'a[href*="/imovel"]']
      .forEach(s => { try { sel[s] = document.querySelectorAll(s).length; } catch { sel[s] = -1; } });
    const firstCard = document.querySelector('[class*="card"], [class*="lot"], article');
    return { sel, sampleHTML: firstCard ? firstCard.outerHTML.slice(0, 2000) : null };
  });
  await gravarDebug('SOLD-domstats', alvo, 200, 'application/json',
    JSON.stringify(domStats, null, 2));
  console.log('  domStats:', JSON.stringify(domStats.sel));

  await browser.close();
  console.log('✅ Debug Sold concluído');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
