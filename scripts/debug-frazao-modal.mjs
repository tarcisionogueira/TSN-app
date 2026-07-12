/**
 * SONDA FRAZAO (modal) v3 — decisiva. Viewport mobile (como no print do dono), rola a
 * página, acha o link "Consulte o edital e documentação" de forma robusta, clica e
 * captura TODA a rede disparada + o modal "Documentos do Lote". Também varre o HTML
 * bruto atrás de .pdf/documentos. Não grava. FZ_N (default 6).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const N = Number(process.env.FZ_N || 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data } = await supabase.from('imoveis_leilao').select('fonte_id, url_lote, link_edital').eq('fonte', 'FRAZAO').eq('ativo', true).limit(30);
  const alvos = (data || []).map(l => ({ fonte_id: l.fonte_id, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, N);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    for (const l of alvos) {
      console.log(`\n════ ${l.fonte_id}  ${l.page}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      const posClick = [];
      let capturando = false;
      page.on('request', req => { if (capturando) { const u = req.url(); if (!/\.(js|css|png|jpe?g|webp|svg|gif|woff2?|ico)(\?|$)/i.test(u)) posClick.push(`${req.method()} ${u.slice(0, 150)}`); } });
      try {
        await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 45000 });
        // rola a página toda para render lazy
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
        await sleep(1500);
        // acha candidatos ao gatilho (ignora offsetParent — pode estar fora da viewport)
        const cand = await page.evaluate(() => {
          const re = /consulte o edital|edital e documenta|documenta[çc][ãa]o|documentos do lote/i;
          return [...document.querySelectorAll('a,button,span,i,div,li,p')]
            .map(e => ({ tag: e.tagName, t: (e.textContent || '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') || '', oc: (e.getAttribute('onclick') || '').slice(0, 60), kids: e.children.length }))
            .filter(o => o.t.length > 3 && o.t.length < 80 && re.test(o.t))
            .sort((a, b) => a.kids - b.kids || a.t.length - b.t.length).slice(0, 5);
        });
        console.log(`  candidatos ao gatilho: ${JSON.stringify(cand)}`);
        capturando = true;
        const clicou = await page.evaluate(() => {
          const re = /consulte o edital|edital e documenta|documenta[çc][ãa]o|documentos do lote/i;
          const cands = [...document.querySelectorAll('a,button,span,i,div,li,p')].filter(e => { const t = (e.textContent || '').replace(/\s+/g, ' ').trim(); return t.length > 3 && t.length < 80 && re.test(t); }).sort((a, b) => a.children.length - b.children.length);
          const el = cands[0]; if (!el) return null;
          el.scrollIntoView(); el.click();
          ['mousedown', 'mouseup', 'click'].forEach(ev => el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true })));
          return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
        });
        console.log(`  clicou em: ${clicou || '(nada)'}`);
        await sleep(4000);
        capturando = false;
        const modal = await page.evaluate(() => {
          const docs = [...document.querySelectorAll('a,[onclick],[data-url],[data-href],[data-file],[data-id]')]
            .map(e => ({ t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46), href: e.getAttribute('href') || '', du: e.getAttribute('data-url') || e.getAttribute('data-href') || e.getAttribute('data-file') || e.getAttribute('data-id') || '', oc: (e.getAttribute('onclick') || '').slice(0, 90) }))
            .filter(a => /\.pdf|cms\/files|arquivo|matr[ií]cul|edital|avalia|penhora|d[eé]bito|instrumento|documento/i.test(a.t + a.href + a.du + a.oc));
          const html = document.documentElement.outerHTML;
          const pdfs = [...new Set((html.match(/https?:[^"'\s)]+\.pdf[^"'\s)]*/gi) || []))].slice(0, 8);
          const temModal = /documentos do lote/i.test(html);
          const idx = html.search(/documentos do lote/i);
          const trecho = idx >= 0 ? html.slice(idx, idx + 700).replace(/\s+/g, ' ') : '';
          return { docs: docs.slice(0, 16), pdfs, temModal, trecho };
        });
        console.log(`  modal "Documentos do Lote" presente no HTML: ${modal.temModal}`);
        console.log(`  docs (âncoras): ${modal.docs.length}`);
        modal.docs.forEach(d => console.log(`     "${d.t}" href=${d.href.slice(0, 70)} du=${d.du.slice(0, 50)} ${d.oc ? 'oc=' + d.oc : ''}`));
        console.log(`  PDFs no HTML: ${JSON.stringify(modal.pdfs)}`);
        console.log(`  rede pós-clique: ${[...new Set(posClick)].slice(0, 12).join(' | ') || '(nenhuma)'}`);
        if (modal.trecho) console.log(`  trecho "Documentos do Lote": ${modal.trecho.slice(0, 600)}`);
      } catch (e) { console.log(`  ERRO ${e.message}`); }
      finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim.');
}
main().catch(e => { console.error(e); process.exit(1); });
