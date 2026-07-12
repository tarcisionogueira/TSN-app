/**
 * SONDA FRAZAO (clique) — revela a estrutura REAL da seção "Documentos" do lote.
 * O probe anterior viu 0 âncoras em networkidle2+2s: os docs (CloudFront cms/files, sem
 * .pdf) são montados por JS/interação. Aqui abrimos a página do lote, CLICAMOS em
 * abas/acordeões/botões que citem "documento/matrícula/edital/laudo", esperamos, e
 * dumpamos: (a) todo <a>/<button> com href/data-* apontando p/ cloudfront ou cms/files
 * ou com texto de tipo de doc; (b) o HTML ao redor de "Documento" DEPOIS do clique;
 * (c) URLs de rede cloudfront/cms/files vistas. Não grava. Config: FZ_N (default 3).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1360,900'];
const N = Number(process.env.FZ_N || 3);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital')
    .eq('fonte', 'FRAZAO').eq('ativo', true).limit(50);
  const alvos = (data || []).map(l => ({ ...l, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, N);
  if (!alvos.length) { console.log('sem lotes'); return; }

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    for (const l of alvos) {
      console.log(`\n════ ${l.fonte_id}\n  ${l.page}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      const cdn = new Set();
      page.on('response', r => { const u = r.url(); if (/cloudfront|cms\/files/i.test(u) && !/\.(js|css|svg|png|jpe?g|gif|woff2?)(\?|$)/i.test(u)) cdn.add(`${r.status()} ${u.slice(0, 140)}`); });
      try {
        await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(1500);
        // clica em qualquer aba/acordeão/botão que cite documento/matrícula/edital/laudo/anexo
        const cliques = await page.evaluate(async () => {
          const kw = /documento|matr[ií]cul|edital|laudo|avalia|anexo|regras|arquivo/i;
          const els = [...document.querySelectorAll('a,button,[role=tab],[data-toggle],.nav-link,.accordion-button,summary,li,span')];
          let n = 0;
          for (const e of els) { if (kw.test(e.textContent || '') && e.offsetParent !== null) { try { e.click(); n++; } catch {} } }
          return n;
        });
        await sleep(2500);
        const info = await page.evaluate(() => {
          const anchors = [...document.querySelectorAll('a,button')].map(e => ({
            t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
            href: e.getAttribute('href') || '',
            du: e.getAttribute('data-url') || e.getAttribute('data-href') || e.getAttribute('data-file') || '',
            onclick: (e.getAttribute('onclick') || '').slice(0, 60),
          })).filter(a => /cloudfront|cms\/files/i.test(a.href + a.du + a.onclick) || /matr[ií]cul|edital|laudo|avalia|documento|regras/i.test(a.t));
          const idx = document.body.innerHTML.search(/documenta[çc][ãa]o|documentos/i);
          const trecho = idx >= 0 ? document.body.innerHTML.slice(idx - 40, idx + 900).replace(/\s+/g, ' ') : '(sem "documentos")';
          return { anchors: anchors.slice(0, 14), trecho };
        });
        console.log(`  cliques=${cliques} | âncoras relevantes=${info.anchors.length}`);
        info.anchors.forEach(a => console.log(`     "${a.t}" href=${a.href.slice(0, 70)} du=${a.du.slice(0, 70)} ${a.onclick ? 'onclick=' + a.onclick : ''}`));
        console.log(`  rede cloudfront/cms: ${[...cdn].slice(0, 8).join(' | ') || '(nenhuma)'}`);
        console.log(`  DOM ~"Documentos": ${info.trecho.slice(0, 700)}`);
      } catch (e) { console.log(`  ERRO ${e.message}`); }
      finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim.');
}
main().catch(e => { console.error(e); process.exit(1); });
