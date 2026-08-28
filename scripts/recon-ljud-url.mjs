/**
 * Recon LJUD — descobre a URL REAL do lote no portal leiloesjudiciais.com.br.
 * Diagnostica o "Leilão não encontrado" do botão "Acessar leiloeiro":
 *  1. Lista lotes ABERTOS pela API do portal.
 *  2. Despeja TODOS os campos de 1 lote (procura url/slug/link reais que o scraper ignora).
 *  3. Com o navegador, testa cada URL candidata: mostra o lote ou "não encontrado"?
 * Só leitura, sem gravar nada. Rodar via workflow_dispatch (recon-ljud-url.yml).
 *
 * ⚠️ REESCRITO EM 28/08 PORQUE ELE MENTIA. A versão anterior chamava a API com um `fetch` do
 * Node, GET e só `tipo=3&pg=1` — e recebia lista vazia. O script então imprimia
 * "API: 0 itens (totalItems=undefined)", seguia para o "=== FIM ===" e SAÍA COM SUCESSO. Um
 * recon que não consegue medir e termina verde é a forma catalogada no CLAUDE.md: o vazio
 * entregue como resposta. Foi o que aconteceu ao rodá-lo hoje, e o diagnóstico quase virou
 * "o portal não tem lotes abertos".
 *
 * O jeito que FUNCIONA é o mesmo do scraper (`scraperLJUD_navegador`): POST com corpo `{}`,
 * o conjunto COMPLETO de parâmetros, e o fetch feito DENTRO da página — o TLS/fingerprint do
 * Chrome real. E agora, sem lote para sondar, o script sai com código 1.
 */
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COMMONS = 'tipo=3&categoria=0&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null';

async function apiLotes(page, endpoint) {
  const url = `https://api.leiloesjudiciais.com.br/core/api/${endpoint}?pg=1&qtd_por_pagina=48&${COMMONS}`;
  const data = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) return { __status: r.status };
      return await r.json();
    } catch (e) { return { __err: String((e && e.message) || e) }; }
  }, url).catch(() => null);
  const items = (data && (data.items || data.data || (Array.isArray(data) ? data : []))) || [];
  return { items, totalItems: data?.totalItems, status: data?.__status, erro: data?.__err };
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
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  // A home primeiro: é ela que entrega o cookie e o contexto de origem da API.
  await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2000));

  let lotes = [];
  for (const endpoint of ['get-lotes', 'get-bens-por-estados']) {
    const { items, totalItems, status, erro } = await apiLotes(page, endpoint);
    console.log(`API ${endpoint}: ${items.length} itens (totalItems=${totalItems ?? '?'})${status ? ` status=${status}` : ''}${erro ? ` erro=${erro}` : ''}`);
    if (items.length) {
      lotes = items.filter(it => Number(it.statuslote_id ?? 1) === 1).slice(0, 3);
      if (!lotes.length) lotes = items.slice(0, 3);
      console.log('\n--- TODOS OS CAMPOS DO 1º LOTE (procurar url/slug/link) ---');
      for (const [k, v] of Object.entries(lotes[0])) {
        const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        if (/url|slug|link|lote|leilao|path|href|seo|codigo/i.test(k)) console.log(`  ${k}: ${val}`);
      }
      console.log('  (chaves completas:', Object.keys(lotes[0]).join(', '), ')');
      break;
    }
  }

  // NÃO CONSEGUIR MEDIR NÃO É RESULTADO. Sem lote, o recon falha em vez de dizer "FIM".
  if (!lotes.length) {
    console.error('\n✗ Nenhum lote veio da API — o recon NÃO mediu nada. Isto não é "o portal está vazio".');
    await browser.close();
    process.exit(1);
  }

  for (const it of lotes) {
    const loteId = it.lote_id || it.id, leilaoId = it.leilao_id;
    const dom = String(it.nm_url_leiloeiro || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const slug = it.nm_slug || it.slug || it.nm_url || null;
    console.log(`\n### lote_id=${loteId} leilao_id=${leilaoId} leiloeiro=${dom} slug=${slug || '—'} | ${String(it.nm_titulo_lote || '').slice(0, 50)}`);
    const cands = [
      `https://www.leiloesjudiciais.com.br/lote/${loteId}`,
      leilaoId ? `https://www.leiloesjudiciais.com.br/leilao/${leilaoId}` : null,
      leilaoId && loteId ? `https://www.leiloesjudiciais.com.br/leilao/${leilaoId}/lote/${loteId}` : null,
      slug ? `https://www.leiloesjudiciais.com.br/${String(slug).replace(/^\//, '')}` : null,
      dom ? `https://${dom}` : null,
    ].filter(Boolean);
    for (const u of cands) {
      const r = await sondar(page, u);
      console.log(`  [${r.status ?? 'ERR'}] ${r.temNaoEncontrado ? '❌ NÃO ENCONTRADO' : '✅ ok?'} ${u}`);
      console.log(`       title="${r.title || ''}" ${r.erro ? 'erro=' + r.erro : ''}`);
      console.log(`       body: ${(r.snippet || '').slice(0, 160)}`);
    }
  }
  await browser.close();
  console.log('\n=== FIM ===');
})();
