/**
 * Recon LJUD — descobre a URL REAL do lote no portal leilõesjudiciais.com.br.
 * Diagnostica o "Leilão não encontrado" do botão "Acessar leiloeiro":
 *  1. Chama a API pública (get-bens-por-estados) e pega 3 lotes ABERTOS.
 *  2. Despeja TODOS os campos de 1 lote (procura url/slug/link reais que o scraper ignora).
 *  3. Com o navegador, testa se as URLs candidatas mostram o lote ou "não encontrado":
 *     /lote/{lote_id} (o que usamos hoje) · /leilao/{leilao_id} · domínio do leiloeiro real.
 * Só leitura, sem gravar nada. Rodar via workflow_dispatch (recon-ljud-url.yml).
 */
import puppeteer from 'puppeteer';

const API = 'https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function apiLotes() {
  // tipo=3 = imóveis; pg=1. Cookie/headers como o scraper.
  const r = await fetch(`${API}?tipo=3&pg=1`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://www.leiloesjudiciais.com.br', Referer: 'https://www.leiloesjudiciais.com.br/' },
  });
  if (!r.ok) throw new Error(`API status ${r.status}`);
  const j = await r.json();
  const items = j?.data || j?.bens || j?.items || (Array.isArray(j) ? j : []);
  return { items, totalItems: j?.totalItems };
}

async function sondar(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500)); // deixa o SPA renderizar
    const info = await page.evaluate(() => {
      const txt = (document.body?.innerText || '').slice(0, 400).replace(/\s+/g, ' ');
      return { title: document.title, temNaoEncontrado: /n[aã]o encontrad/i.test(document.body?.innerText || ''), snippet: txt };
    });
    return { url, status: resp?.status?.() ?? null, ...info };
  } catch (e) { return { url, erro: String(e.message).slice(0, 80) }; }
}

(async () => {
  console.log('=== RECON LJUD URL ===');
  let lotes = [];
  try {
    const { items, totalItems } = await apiLotes();
    console.log(`API: ${items.length} itens (totalItems=${totalItems})`);
    lotes = items.filter(it => Number(it.statuslote_id) === 1).slice(0, 3);
    if (lotes[0]) {
      console.log('\n--- TODOS OS CAMPOS DO 1º LOTE ABERTO (procurar url/slug/link) ---');
      for (const [k, v] of Object.entries(lotes[0])) {
        const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        if (/url|slug|link|lote|leilao|path|href|seo/i.test(k)) console.log(`  ${k}: ${val}`);
      }
      console.log('  (chaves completas:', Object.keys(lotes[0]).join(', '), ')');
    }
  } catch (e) { console.log('API falhou:', e.message); }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  for (const it of lotes) {
    const loteId = it.lote_id, leilaoId = it.leilao_id, dom = String(it.nm_url_leiloeiro || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    console.log(`\n### lote_id=${loteId} leilao_id=${leilaoId} leiloeiro=${dom} | ${String(it.nm_titulo_lote || '').slice(0, 50)}`);
    const cands = [
      `https://www.leiloesjudiciais.com.br/lote/${loteId}`,
      `https://www.leiloesjudiciais.com.br/leilao/${leilaoId}`,
      leilaoId && loteId ? `https://www.leiloesjudiciais.com.br/leilao/${leilaoId}/lote/${loteId}` : null,
      dom ? `https://${dom}` : null,
    ].filter(Boolean);
    for (const u of cands) {
      const r = await sondar(page, u);
      console.log(`  [${r.status ?? 'ERR'}] ${r.temNaoEncontrado ? '❌ NÃO ENCONTRADO' : '✅ ok?'} ${u}`);
      console.log(`       title="${r.title || ''}" ${r.erro ? 'erro=' + r.erro : ''}`);
      console.log(`       body: ${(r.snippet || '').slice(0, 140)}`);
    }
  }
  await browser.close();
  console.log('\n=== FIM ===');
})();
