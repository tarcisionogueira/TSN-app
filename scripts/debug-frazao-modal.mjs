/**
 * SONDA FRAZAO (modal) — clica em "Consulte o edital e documentação" e captura o modal
 * "Documentos do Lote" (os PDFs: Edital, Matrícula, Avaliação, Termo de penhora…).
 * Reporta as URLs + rótulos e a rede disparada ao abrir o modal. Não grava. FZ_N (default 2).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const N = Number(process.env.FZ_N || 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data } = await supabase.from('imoveis_leilao').select('fonte_id, url_lote, link_edital').eq('fonte', 'FRAZAO').eq('ativo', true).limit(20);
  const alvos = (data || []).map(l => ({ fonte_id: l.fonte_id, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, N);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    for (const l of alvos) {
      console.log(`\n════ ${l.fonte_id}\n  ${l.page}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      const net = [];
      const saleBodies = [];
      page.on('response', async r => {
        const u = r.url();
        if (/\.pdf|cms\/files|arquivo|document|\/Sale\/|\/Lot/i.test(u) && !/\.(js|css|png|jpe?g|webp|svg|woff2?)(\?|$)/i.test(u)) net.push(`${r.status()} ${(r.headers()['content-type'] || '').split(';')[0]} ${u.slice(0, 150)}`);
        if (/\/Sale\//i.test(u)) { try { const t = await r.text(); if (/\.pdf|cms\/files|matr[ií]cul|edital|avalia|penhora/i.test(t)) saleBodies.push({ u: u.slice(0, 90), t: t.replace(/\s+/g, ' ').slice(0, 400) }); } catch { /* */ } }
      });
      const loteId = (l.page.match(/\/lote\/(\d+)/) || [])[1] || (l.fonte_id.match(/(\d+)/) || [])[1];
      try {
        await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 45000 });
        await sleep(1500);
        // clica EXATAMENTE no link "Consulte o edital e documentação" (folha, texto curto)
        const clicou = await page.evaluate(() => {
          const cands = [...document.querySelectorAll('a,button,[onclick],span,i,label')]
            .filter(e => e.offsetParent !== null)
            .map(e => ({ e, t: (e.textContent || '').replace(/\s+/g, ' ').trim() }))
            .filter(o => o.t.length > 3 && o.t.length < 70 && /consulte|documenta[çc][ãa]o|edital e documenta/i.test(o.t));
          cands.sort((a, b) => (a.e.children.length - b.e.children.length) || (a.t.length - b.t.length));
          if (cands[0]) { cands[0].e.click(); return cands[0].t; }
          return null;
        });
        console.log(`  clicou em: ${clicou || '(gatilho não encontrado)'}`);
        await sleep(3500);
        // sonda direta de endpoints .NET candidatos do modal de documentos
        console.log('  endpoints candidatos:');
        for (const ep of ['GetDocumentos', 'Documentos', 'GetLotDocuments', 'DocumentosDoLote', 'GetDocuments', 'DocumentosLote', 'LotDocuments']) {
          const url = `https://www.frazaoleiloes.com.br/Sale/${ep}?loteId=${loteId}`;
          const res = await page.evaluate(async (u) => { try { const r = await fetch(u, { credentials: 'include' }); const t = await r.text(); return { s: r.status, n: t.length, has: /\.pdf|cms\/files|matr[ií]cul|edital/i.test(t), amostra: t.replace(/\s+/g, ' ').slice(0, 200) }; } catch (e) { return { err: String(e).slice(0, 40) }; } }, url).catch(() => null);
          if (res && (res.has || (res.s === 200 && res.n > 20))) console.log(`     ${ep} → status=${res.s} len=${res.n} temDoc=${res.has} :: ${res.amostra}`);
          else if (res) console.log(`     ${ep} → status=${res?.s ?? '?'} len=${res?.n ?? 0} temDoc=${res?.has ?? false}${res?.err ? ' err=' + res.err : ''}`);
        }
        // dumpa o modal "Documentos do Lote"
        const modal = await page.evaluate(() => {
          const docs = [...document.querySelectorAll('a,button,[onclick],[data-url],[data-href],[data-file]')]
            .map(e => ({ t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), href: e.getAttribute('href') || '', du: e.getAttribute('data-url') || e.getAttribute('data-href') || e.getAttribute('data-file') || '', oc: (e.getAttribute('onclick') || '').slice(0, 80) }))
            .filter(a => /\.pdf|cms\/files|arquivo|matr[ií]cul|edital|avalia|penhora|d[eé]bito|instrumento/i.test(a.t + a.href + a.du + a.oc));
          const tit = [...document.querySelectorAll('*')].find(e => /documentos do lote/i.test(e.textContent || '') && e.children.length < 3);
          const bloco = tit ? (tit.closest('.modal,[role=dialog],div') || tit.parentElement)?.innerHTML?.replace(/\s+/g, ' ').slice(0, 1200) : '';
          return { docs: docs.slice(0, 16), bloco };
        });
        console.log(`  docs no modal: ${modal.docs.length}`);
        modal.docs.forEach(d => console.log(`     "${d.t}" href=${d.href.slice(0, 80)} du=${d.du.slice(0, 80)} ${d.oc ? 'oc=' + d.oc : ''}`));
        console.log(`  rede (doc): ${[...new Set(net)].slice(0, 8).join(' | ') || '(nenhuma)'}`);
        saleBodies.slice(0, 3).forEach(b => console.log(`  Sale body ${b.u}: ${b.t}`));
        if (!modal.docs.length && modal.bloco) console.log(`  modal HTML: ${modal.bloco.slice(0, 700)}`);
      } catch (e) { console.log(`  ERRO ${e.message}`); }
      finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim.');
}
main().catch(e => { console.error(e); process.exit(1); });
