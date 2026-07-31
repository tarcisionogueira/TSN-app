/**
 * Recon LEILOFY (leiloariasmart.com.br) — descobre os VALORES REAIS de um lote e por que o
 * scraper gravou o valor errado (ex.: casa 1058m² no Tamboré com lance mínimo R$ 20.000).
 * Datacenter fetch dá 403 (Cloudflare), então roda em navegador real (puppeteer).
 * Dumpa: título, TODOS os "R$ x.xxx,xx" com o contexto ao redor, e os rótulos-chave
 * (lance/avaliação/1ª e 2ª praça/incremento). Só leitura. Rodar via workflow_dispatch.
 */
import puppeteer from 'puppeteer';

const IDS = (process.env.LEILOFY_IDS || '1676').split(',').map(s => s.trim()).filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

(async () => {
  console.log('=== RECON LEILOFY VALOR ===');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  for (const id of IDS) {
    const url = `https://leiloariasmart.com.br/imovel/${id}`;
    console.log(`\n############### LOTE ${id} — ${url}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2500));
      console.log(`  HTTP ${resp?.status?.() ?? '?'} · título: ${await page.title()}`);
      const info = await page.evaluate(() => {
        const txt = (document.body?.innerText || '').replace(/\r/g, '');
        // Todos os R$ com ~40 chars antes (o rótulo costuma vir antes do valor).
        const valores = [];
        const re = /R\$\s*[\d.]+,\d{2}/g;
        let m;
        while ((m = re.exec(txt)) !== null) {
          const ini = Math.max(0, m.index - 45);
          valores.push('…' + txt.slice(ini, m.index + m[0].length).replace(/\s+/g, ' ').trim());
        }
        // Linhas que contêm rótulos-chave.
        const chaves = txt.split('\n').map(l => l.trim()).filter(l =>
          /(lance|avalia|pra[çc]a|incremento|arremat|m[íi]nimo|valor|d[ée]bito)/i.test(l) && l.length < 120);
        return { valores, chaves: [...new Set(chaves)].slice(0, 40) };
      });
      console.log(`  --- ${info.valores.length} valores R$ (com contexto anterior) ---`);
      info.valores.forEach(v => console.log('    ' + v));
      console.log('  --- linhas com rótulos-chave ---');
      info.chaves.forEach(l => console.log('    | ' + l));
    } catch (e) { console.log(`  ERRO: ${String(e.message).slice(0, 120)}`); }
  }
  await browser.close();
  console.log('\n=== FIM ===');
})();
