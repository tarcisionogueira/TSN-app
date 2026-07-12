/**
 * RECON FRAZAO (navegador) — grampeia a rede para achar de onde vêm os documentos.
 * Frazão é ASP.NET MVC (cookies ARRAffinity/__goc_session__; endpoints /Sale/...).
 * Abre um lote real, clica em "Documentos", e captura TODA chamada relevante
 * (/Sale/|/api|/Account|/Lot|document|anexo|arquivo|matricul|edital|cloudfront|.pdf),
 * com corpo das respostas que parecem carregar documentos. Também sonda rotas de
 * login .NET comuns. Credenciais FRAZAO_EMAIL/FRAZAO_SENHA (para ver o que muda logado).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const BASE = 'https://www.frazaoleiloes.com.br';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RE = /\/Sale\/|\/api|\/Account|\/Lot|\/Document|document|anexo|arquivo|matricul|edital|laudo|cloudfront|\.pdf/i;
const RE_DOCBODY = /\/Sale\/|\/Lot|document|anexo|arquivo/i;

async function main() {
  const { data } = await supabase.from('imoveis_leilao').select('fonte_id, url_lote, link_edital').eq('fonte', 'FRAZAO').eq('ativo', true).limit(5);
  const alvo = (data || []).map(l => (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital).find(u => u && /^https?:/.test(u));
  console.log(`lote alvo: ${alvo || '(nenhum)'}`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const net = [];
  const bodies = [];
  page.on('request', req => { const u = req.url(); if (RE.test(u)) net.push(`${req.method()} ${u.slice(0, 150)}`); });
  page.on('response', async r => {
    const u = r.url();
    if (RE.test(u)) {
      net.push(`  ↳ ${r.status()} ${(r.headers()['content-type'] || '').split(';')[0]} ${u.slice(0, 130)}`);
      if (RE_DOCBODY.test(u) && /json|html|text/i.test(r.headers()['content-type'] || '')) {
        try { const t = await r.text(); if (/arquivo|anexo|matricul|edital|laudo|\.pdf|cloudfront/i.test(t)) bodies.push({ u: u.slice(0, 120), amostra: t.replace(/\s+/g, ' ').slice(0, 500) }); } catch { /* */ }
      }
    }
  });

  try {
    // sonda rotas de login .NET comuns
    console.log('\n── rotas de login candidatas (.NET):');
    for (const rota of ['/Account/Login', '/Login', '/Cliente/Login', '/Participante/Login', '/Usuario/Login', '/Conta/Entrar']) {
      try { const r = await page.goto(BASE + rota, { waitUntil: 'domcontentloaded', timeout: 20000 }); const temPass = await page.evaluate(() => !!document.querySelector('input[type=password]')); console.log(`   ${rota} → ${r.status()} pass=${temPass}`); } catch (e) { console.log(`   ${rota} ERRO ${e.message}`); }
    }

    if (alvo) {
      console.log(`\n── abrindo o lote e capturando a rede`);
      net.length = 0; bodies.length = 0;
      await page.goto(alvo, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(2000);
      // clica qualquer coisa de "documento/matrícula/edital/laudo/anexo"
      const cliques = await page.evaluate(() => { let n = 0; for (const e of document.querySelectorAll('a,button,[role=tab],.nav-link,.accordion-button,li,span,div[onclick]')) { if (/documento|matr[ií]cul|edital|laudo|anexo|arquivo/i.test(e.textContent || '') && e.offsetParent !== null) { try { e.click(); n++; } catch {} } } return n; });
      await sleep(3000);
      // procura links/js que citem Sale/ ou arquivo por lote
      const domInfo = await page.evaluate(() => {
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent || '').join(' ');
        const saleRefs = [...new Set((scripts.match(/\/Sale\/[A-Za-z]+/g) || []))].slice(0, 10);
        const anchors = [...document.querySelectorAll('a,button')].map(a => ({ t: (a.textContent || '').trim().slice(0, 24), h: a.getAttribute('href') || '', du: a.getAttribute('data-url') || a.getAttribute('onclick') || '' })).filter(a => /matr[ií]cul|edital|laudo|documento|arquivo|\.pdf/i.test(a.t + a.h + a.du)).slice(0, 10);
        return { saleRefs, anchors };
      });
      console.log(`   cliques=${cliques}`);
      console.log(`   refs /Sale/ no JS: ${JSON.stringify(domInfo.saleRefs)}`);
      console.log(`   âncoras de doc: ${JSON.stringify(domInfo.anchors)}`);
    }

    console.log('\n══ REDE capturada (lote):');
    [...new Set(net)].slice(0, 30).forEach(l => console.log(`   ${l}`));
    console.log('\n══ CORPOS com sinais de documento:');
    bodies.slice(0, 6).forEach(b => console.log(`   ${b.u}\n      ${b.amostra}`));
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim recon FRAZAO.');
}
main().catch(e => { console.error(e); process.exit(1); });
