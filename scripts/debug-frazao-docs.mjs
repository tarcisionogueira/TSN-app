/**
 * SONDA (throwaway) — FRAZAO: qual a estrutura real da seção "Documentos"?
 *
 * As páginas de lote do frazaoleiloes.com.br listam Matrícula, Edital, Laudo e
 * Regras de venda, mas os arquivos ficam no CloudFront SEM extensão .pdf
 * (ex.: d335luupugsy2.cloudfront.net/cms/files/.../$u8jkx6pzv9d). Por isso o
 * vasculharDocumentos() genérico captura só 1 "anexo" por lote em vez de
 * classificar matrícula/edital/laudo. Esta sonda abre 3 lotes ativos no
 * navegador REAL e imprime:
 *   - o HTML ao redor do heading/section que contém "Documento" (~1500 chars)
 *   - cada <a> relevante (cloudfront / cms/files / texto matrícula|edital|laudo|
 *     regras|avaliação): texto, href e atributos data-*
 * NÃO grava nada. Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];

async function main() {
  const { data: lotes, error } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital')
    .eq('fonte', 'FRAZAO').eq('ativo', true).limit(200);
  if (error) { console.error(error.message); process.exit(1); }
  const alvos = (lotes || [])
    .map(l => ({ ...l, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, 3);
  if (!alvos.length) { console.log('FRAZAO: nenhum lote com página navegável.'); return; }
  console.log(`\n🔎 Sonda FRAZAO — ${alvos.length} lote(s) no navegador real.\n`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    for (const l of alvos) {
      console.log(`\n════════ ${l.fonte_id}`);
      console.log(`URL: ${l.page}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
      try {
        const resp = await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 40000 });
        await new Promise(r => setTimeout(r, 2000));
        console.log(`  HTTP: ${resp?.status()}`);

        // 1) Trecho do DOM ao redor do heading/section contendo "Documento"
        const trecho = await page.evaluate(() => {
          const re = /documento/i;
          // procura primeiro um heading/section cujo texto próprio mencione "Documento"
          const cands = [...document.querySelectorAll('h1,h2,h3,h4,h5,section,div,summary,strong,b,label')];
          const hit = cands.find(el => re.test(el.textContent || '') && (el.textContent || '').length < 4000);
          const node = hit || document.body;
          // sobe para um ancestral com algum conteúdo de links, se possível
          let scope = node;
          for (let i = 0; i < 3 && scope.parentElement; i++) {
            if (scope.querySelector && scope.querySelector('a')) break;
            scope = scope.parentElement;
          }
          return (scope.outerHTML || '').slice(0, 1500);
        }).catch(e => `ERRO trecho: ${e.message}`);
        console.log(`  --- DOM ~"Documento" (1500c) ---\n${trecho}`);

        // 2) Cada <a> relevante: cloudfront / cms/files / texto de documento
        const anchors = await page.evaluate(() => {
          const kwTexto = /matr[ií]cul|edital|laudo|regras|avalia[çc]/i;
          const kwUrl = /cloudfront|cms\/files/i;
          const out = [];
          for (const a of document.querySelectorAll('a')) {
            const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
            const href = a.getAttribute('href') || '';
            const datas = {};
            for (const at of a.attributes) if (at.name.startsWith('data-')) datas[at.name] = at.value;
            const dataStr = Object.values(datas).join(' ');
            const relevante = kwUrl.test(href) || kwUrl.test(dataStr) || kwTexto.test(text);
            if (relevante) out.push({ text: text.slice(0, 80), href: href.slice(0, 160), datas });
          }
          return out;
        }).catch(e => { console.log(`  ERRO anchors: ${e.message}`); return []; });

        console.log(`  --- ${anchors.length} <a> relevante(s) ---`);
        anchors.forEach((a, i) => {
          const d = Object.entries(a.datas).map(([k, v]) => `${k}="${String(v).slice(0, 100)}"`).join(' ');
          console.log(`   [${i}] texto="${a.text}"`);
          console.log(`        href=${a.href}`);
          if (d) console.log(`        data=${d}`);
        });
      } catch (e) {
        console.log(`  ERRO ao abrir: ${e.message}`);
      } finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim da sonda FRAZAO.');
}

main().catch((e) => { console.error(e); process.exit(1); });
