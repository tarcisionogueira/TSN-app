// RECON (dispatch-only, GRÁTIS via Puppeteer no GitHub Actions) — descobre onde está o
// link do EDITAL na página do lote do Zuk (portalzuk), para depois plugar a captura no
// enriquecimento (enriquecerDatasZuk já visita a página, custo zero). Visita alguns
// lotes ZUK ativos e LOGA os <a href> a PDF/edital + contexto. NÃO grava nada.
// Depois de rodar, ler o log da Action para o padrão do link e então codar a captura.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const N = Number(process.env.RECON_ZUK_N || 8);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const { data: lotes, error } = await supabase.from('imoveis_leilao')
  .select('id, titulo, link_edital')
  .eq('fonte', 'ZUK').eq('ativo', true)
  .not('link_edital', 'is', null)
  .limit(N);
if (error) { console.error('erro ao ler lotes:', error.message); process.exit(1); }
console.log(`ZUK recon edital: ${lotes?.length || 0} lote(s) a visitar.`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setUserAgent(UA);
for (const l of (lotes || [])) {
  try {
    await page.goto(l.link_edital, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 1500));
    const achados = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        const txt = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
        if (/\.pdf|edital|documento|matr[íi]cula|anexo/i.test(href) || /edital|documento|matr[íi]cula|anexo|baixar/i.test(txt)) {
          out.push({ txt, href: href.slice(0, 180) });
        }
      });
      return out.slice(0, 25);
    });
    console.log(`\n=== ${(l.titulo || '').slice(0, 55)} ===\n${l.link_edital}`);
    console.log(achados.length ? JSON.stringify(achados, null, 2) : '  (nenhum link de edital/pdf encontrado)');
  } catch (e) { console.log(`  erro ${l.id}: ${String(e.message).slice(0, 90)}`); }
}
await browser.close();
console.log('\nRecon concluído — usar os padrões acima para plugar a captura do edital ZUK.');
