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
  // === Round 10 — viabilidade de novos alvos (nacional/banco) ===
  // Recon de estrutura: intercepta XHR JSON (xhr-list = endpoint de dados), render
  // (server-rendered?) e domstats (card + href). Define complexidade de cada.
  // Marteleiro: meta-agregador (24k+ imóveis, mostra por-estado → backend estruturado).
  { fonte: 'MARTELEIRO', url: 'https://marteleiro.com.br/imoveis' },
  // MGL: leiloeiro nacional (rota /lotes/imoveis vista em recon anterior).
  { fonte: 'MGL', url: 'https://www.mgl.com.br/lotes/imoveis' },
  // Seu Imóvel BB (banco): rota de listagem incerta → home revela nav + endpoint.
  { fonte: 'SEUIMOVELBB', url: 'https://www.seuimovelbb.com.br/' },
  // Grupo Lance: rota incerta → home revela nav + endpoint de dados.
  { fonte: 'GRUPOLANCE', url: 'https://www.grupolance.com.br/' },
];

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
  } finally {
    await browser.close();
  }
  console.log('\n✅ Debug leiloeiros concluído');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
