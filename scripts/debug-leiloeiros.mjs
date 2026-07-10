/**
 * Captura de diagnóstico de leiloeiros (Superbid, Sold, BB, Zukerman).
 * Para cada fonte: abre no navegador real, intercepta as APIs XHR JSON e
 * grava o DOM renderizado + os maiores JSON + estatísticas de seletores em
 * debug_fetch — base para escrever os parsers definitivos.
 *
 * Não grava em imoveis_leilao. Rodar via workflow debug-leiloeiros.yml.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ALVOS = [
  // Round 20 — LEILOTECH (plataforma white-label GraphQL). Objetivo: (1) listar os
  // leiloeiros clientes da Leilotech (/clientes) para medir o alcance; (2) achar a
  // rota de catálogo que dispara a query GraphQL de lotes (interceptamos o POST).
  { fonte: 'LT-CLIENTES', url: 'https://leilotech.com.br/clientes' },
  { fonte: 'TOPO-LOTES',  url: 'https://topoleiloes.com.br/lotes' },
  { fonte: 'TOPO-CAT',    url: 'https://topoleiloes.com.br/categoria/imoveis' },
  { fonte: 'TOPO-LEIL',   url: 'https://topoleiloes.com.br/leiloes' },
  { fonte: 'LT-DEMO',     url: 'https://demo.leilotech.com.br/lotes' },
];

// Diagnóstico VIP: pega os eventos da agenda e, para cada um, conta os cards de
// anúncio via 3 métodos (DOM da detalhe / fetch /evento/lotes / fetch com header
// XHR). Mostra POR QUE a coleta traz só 7 — quais eventos têm imóveis e qual
// método realmente devolve os cards.
async function scanVIP(browser) {
  console.log('🔎 Diagnóstico Leilão VIP (contagem de anúncios por evento)...');
  const VIP = 'https://www.leilaovip.com.br';
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const relatorio = { agenda: {}, eventos: [] };
  try {
    await page.goto(`${VIP}/agenda?segmento=Im%C3%B3veis`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const info = await page.evaluate(() => {
      const detalhes = new Set(), anuncioLinks = new Set();
      document.querySelectorAll('a[href*="/evento/detalhes/"]').forEach(a => {
        const m = (a.getAttribute('href') || '').match(/\/evento\/detalhes\/([^/?#]+)/); if (m) detalhes.add(m[1]);
      });
      document.querySelectorAll('a[href*="/evento/anuncio/"]').forEach(a => anuncioLinks.add(a.getAttribute('href')));
      return {
        nCardEvento: document.querySelectorAll('.card-evento').length,
        nCardAnuncio: document.querySelectorAll('.card-anuncio').length,
        nCard: document.querySelectorAll('[class*="card"]').length,
        detalhes: [...detalhes], nAnuncioLinks: anuncioLinks.size,
      };
    });
    relatorio.agenda = { nCardEvento: info.nCardEvento, nCardAnuncio: info.nCardAnuncio, nCard: info.nCard, nEventos: info.detalhes.length, nAnuncioLinks: info.nAnuncioLinks };

    for (const ev of info.detalhes.slice(0, 8)) {
      await page.goto(`${VIP}/evento/detalhes/${ev}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      const r = await page.evaluate(async (id) => {
        const cnt = (html) => { try { return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.card-anuncio').length; } catch { return -1; } };
        const domDetalhe = document.querySelectorAll('.card-anuncio').length;
        let lotesPlain = { status: 0, cards: -1, len: 0 };
        let lotesXhr = { status: 0, cards: -1, len: 0 };
        try { const x = await fetch(`/evento/lotes/${id}`, { credentials: 'include' }); const t = await x.text(); lotesPlain = { status: x.status, cards: cnt(t), len: t.length }; } catch (e) { lotesPlain.err = String(e && e.message); }
        try { const x = await fetch(`/evento/lotes/${id}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); const t = await x.text(); lotesXhr = { status: x.status, cards: cnt(t), len: t.length }; } catch (e) { lotesXhr.err = String(e && e.message); }
        return { domDetalhe, lotesPlain, lotesXhr };
      }, ev).catch((e) => ({ erro: String(e && e.message) }));
      relatorio.eventos.push({ ev, ...r });
    }
  } catch (e) { relatorio.erro = String(e && e.message); }
  await gravarDebug('VIP-DIAG', 'scan', 200, 'application/json', JSON.stringify(relatorio, null, 2));
  console.log('  ', JSON.stringify(relatorio).slice(0, 400));
  await page.close();
}

// Mede o VOLUME de imóveis por portal do Superbid e IDENTIFICA o leiloeiro/portal
// via seoTitle+seoBreadcrumb. Depois testa SOBREPOSIÇÃO: pega o 1º offer de cada
// sub-portal e verifica se ele TAMBÉM aparece no portal 2 (marketplace-mãe) — se
// sim, plugar sub-portais só traz DUPLICADOS, não imóveis novos.
async function scanSuperbidPortais(browser) {
  console.log('🔎 Scan de portais do Superbid (volume + identidade + sobreposição)...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  try { await page.goto('https://www.superbid.net/', { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch {}
  await new Promise(r => setTimeout(r, 3000));
  const res = await page.evaluate(async () => {
    const base = 'https://offer-query.superbid.net/offers/';
    const q = (portal, size, id) =>
      `${base}?portalId=[${portal}]&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=1&pageSize=${size}&orderBy=endDate:asc`;
    const out = [];
    // 1) volume + identidade por portal
    for (let portal = 1; portal <= 120; portal++) {
      try {
        const r = await fetch(q(portal, 1), { headers: { Accept: 'application/json' } });
        if (!r.ok) continue;
        const d = await r.json();
        const total = d.total ?? d.totalElements ?? d.totalCount ?? null;
        const first = (d.offers || d.content || d.results || d.items || [])[0] || null;
        if ((total && total > 0) || first) {
          out.push({
            portal, total,
            seoTitle: d.seoTitle || null,
            seoBreadcrumb: JSON.stringify(d.seoBreadcrumb || null).slice(0, 300),
            firstId: first?.id ?? null,
          });
        }
      } catch (e) { /* portal inexistente */ }
      await new Promise(r => setTimeout(r, 50));
    }
    // 2) teste de sobreposição: os primeiros 100 ids do portal 2 (mãe) contêm os
    //    firstId dos sub-portais? Se sim → sub-portais são subconjunto do portal 2.
    let idsPortal2 = [];
    try {
      const r = await fetch(q(2, 100), { headers: { Accept: 'application/json' } });
      const d = await r.json();
      idsPortal2 = (d.offers || d.content || []).map(o => o.id);
    } catch {}
    const overlap = out
      .filter(p => p.portal !== 2 && p.firstId)
      .map(p => ({ portal: p.portal, firstId: p.firstId, noPortal2: idsPortal2.includes(p.firstId) }));
    return { portais: out, idsPortal2Count: idsPortal2.length, overlap };
  }).catch((e) => ({ erro: String(e && e.message || e) }));
  await gravarDebug('SUPERBID-PORTAIS', 'scan-1-120+overlap', 200, 'application/json', JSON.stringify(res, null, 2));
  console.log(`  resultado: ${JSON.stringify(res).slice(0, 200)}`);
  await page.close();
}

async function gravarDebug(fonte, url, status, contentType, conteudo) {
  const txt = String(conteudo || '').slice(0, 400000);
  const { error } = await supabase.from('debug_fetch').insert({
    fonte, url, status, content_type: contentType, via: 'puppeteer', conteudo: txt,
  });
  if (error) console.log(`  erro gravarDebug ${fonte}: ${error.message}`);
  else console.log(`  gravado ${fonte} (${txt.length} chars)`);
}

async function capturar(browser, { fonte, url, inPageApi, inPageApis }) {
  console.log(`\n=== ${fonte} → ${url}`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const xhrs = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const text = await resp.text();
      if (text.length < 80) return;
      let reqHeaders = {};
      try { reqHeaders = resp.request().headers(); } catch {}
      xhrs.push({ url: resp.url(), ct, status: resp.status(), text, reqHeaders });
    } catch {}
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch (e) {
    console.log(`  goto falhou: ${e.message.slice(0, 80)}`);
  }
  await new Promise(r => setTimeout(r, 6000));

  // Autoscroll: dispara lazy-load/paginação-ao-rolar de SPAs (o catálogo às vezes
  // só busca a API quando a lista entra em viewport). Best-effort.
  try {
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2500));
  } catch { /* ok */ }

  // Fetch de API dentro do contexto da página (usa o TLS/fingerprint do Chrome real
  // e carrega Origin/Referer corretos — vários endpoints/WAFs dão 403/405 a fetch
  // de datacenter ou navegação direta). Aceita uma única (inPageApi) ou várias
  // sondas (inPageApis) quando a rota exata ainda é desconhecida.
  const apis = [...(inPageApis || []), ...(inPageApi ? [inPageApi] : [])];
  for (let i = 0; i < apis.length; i++) {
    const u = apis[i];
    try {
      const res = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
          return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() };
        } catch (e) { return { status: 0, ct: '', text: `__err: ${String((e && e.message) || e)}` }; }
      }, u);
      await gravarDebug(`${fonte}-api-${i + 1}`, u, res.status, res.ct || 'application/json', res.text);
      console.log(`  inPageApi ${fonte} [${res.status}] ${String(res.text).length}b ${u.slice(0, 90)}`);
    } catch (e) { console.log(`  inPageApi falhou (${u.slice(0, 60)}): ${e.message.slice(0, 60)}`); }
  }

  // DOM renderizado
  let html = '';
  try { html = await page.content(); } catch {}
  await gravarDebug(`${fonte}-render`, url, 200, 'text/html', html);

  // Lista de XHRs (maiores primeiro)
  xhrs.sort((a, b) => b.text.length - a.text.length);
  const lista = xhrs.map(x => `${x.status} ${x.text.length}b ${x.ct}\n${x.url}`).join('\n\n');
  await gravarDebug(`${fonte}-xhr-list`, url, 200, 'text/plain', lista || '(nenhum JSON)');
  console.log(`  XHRs JSON: ${xhrs.length}`);
  xhrs.slice(0, 6).forEach(x => console.log(`    ${x.text.length}b ${x.url.slice(0, 110)}`));

  // 2 maiores JSON
  for (let i = 0; i < Math.min(2, xhrs.length); i++) {
    await gravarDebug(`${fonte}-xhr-${i + 1}`, xhrs[i].url, xhrs[i].status, xhrs[i].ct, xhrs[i].text);
  }

  // XHRs de interesse (independem do tamanho): endpoints por-bem/imóvel/lote
  const INTERESSE = /get-bens|get-imovel|get-lote|\/imovel|\/bens|\/lotes|por-estado/i;
  let m = 0;
  for (const x of xhrs) {
    if (INTERESSE.test(x.url) && m < 4) {
      m++;
      await gravarDebug(`${fonte}-match-${m}`, x.url, x.status, x.ct, x.text);
      await gravarDebug(`${fonte}-match-${m}-reqhdr`, x.url, x.status, 'application/json', JSON.stringify(x.reqHeaders || {}, null, 2));
      console.log(`  match ${m}: ${x.text.length}b ${x.url.slice(0, 120)}`);
    }
  }

  // Estatísticas de seletores no DOM + 1º card de exemplo
  try {
    const dom = await page.evaluate(() => {
      const sel = {};
      ['[class*="card"]', '[class*="lot"]', '[class*="product"]', '[class*="offer"]', '[class*="imovel"]', 'article', '[data-id]', '[data-key]', 'a[href*="/lote"]', 'a[href*="/imovel"]', 'a[href*="/imoveis"]']
        .forEach(s => { try { sel[s] = document.querySelectorAll(s).length; } catch { sel[s] = -1; } });
      const c = document.querySelector('[class*="card"], [class*="lot"], [class*="product"], article');
      return { sel, sample: c ? c.outerHTML.slice(0, 2200) : null };
    });
    await gravarDebug(`${fonte}-domstats`, url, 200, 'application/json', JSON.stringify(dom, null, 2));
    console.log(`  domstats: ${JSON.stringify(dom.sel)}`);
  } catch (e) { console.log(`  domstats falhou: ${e.message.slice(0, 60)}`); }

  await page.close();
}

async function main() {
  console.log('🔎 Debug leiloeiros —', new Date().toISOString());
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    for (const alvo of ALVOS) {
      try { await capturar(browser, alvo); }
      catch (e) { console.log(`  ${alvo.fonte} erro: ${e.message.slice(0, 80)}`); }
    }
    try { await scanVIP(browser); } catch (e) { console.log(`  scanVIP erro: ${e.message.slice(0, 80)}`); }
  } finally {
    await browser.close();
  }
  console.log('\n✅ Debug leiloeiros concluído');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
