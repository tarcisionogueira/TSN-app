/**
 * SONDA (Puppeteer) — Grupo Lance: por que o enrich não captura os documentos?
 *
 * O usuário provou por screenshot que o lote 20920 TEM Documentos (Edital, Processo,
 * Auto de avaliação, Matrícula, Análise processual) na página — mas o banco tem 0 anexos.
 * Esta sonda abre as páginas de detalhe no navegador REAL e reporta, lote a lote:
 *   - status HTTP e se a palavra "Documentos" aparece no DOM renderizado
 *   - TODOS os links .pdf/documento achados por regex amplo no HTML final
 *   - o que o vasculharDocumentos() (o capturador real) devolve
 *   - se os docs podem estar atrás de aba/clique (conta <a>/<button> com "documento")
 *   - um trecho do DOM ao redor de "Documentos" (para ver a estrutura real)
 *
 * NÃO grava nada — só diagnostica. Roda no GitHub Actions (egress aberto).
 * Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.  Config: GL_IDS (csv de fonte_id).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { vasculharDocumentos } from '../api/_doc-scan.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];

// Lotes a sondar: por padrão inclui o do screenshot (gl_20920) + amostra automática
// de sem-anexos e um com-anexos (controle). Pode sobrescrever via GL_IDS=gl_x,gl_y.
async function escolherLotes() {
  const idsEnv = (process.env.GL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (idsEnv.length) {
    const { data } = await supabase.from('imoveis_leilao')
      .select('id, fonte_id, url_lote, anexos').in('fonte_id', idsEnv);
    return data || [];
  }
  const alvo = [];
  const scr = await supabase.from('imoveis_leilao').select('id, fonte_id, url_lote, anexos').eq('fonte_id', 'gl_20920').limit(1);
  if (scr.data?.length) alvo.push(scr.data[0]);
  const sem = await supabase.from('imoveis_leilao').select('id, fonte_id, url_lote, anexos')
    .eq('fonte', 'GRUPOLANCE').eq('ativo', true)
    .or('anexos.is.null,anexos.eq.[]').not('url_lote', 'is', null).limit(3);
  alvo.push(...(sem.data || []));
  const com = await supabase.from('imoveis_leilao').select('id, fonte_id, url_lote, anexos')
    .eq('fonte', 'GRUPOLANCE').eq('ativo', true).not('anexos', 'is', null).limit(1);
  // filtra p/ um com anexos de verdade
  const comReal = (com.data || []).find(l => Array.isArray(l.anexos) && l.anexos.length);
  if (comReal) alvo.push(comReal);
  // dedup por fonte_id
  const seen = new Set();
  return alvo.filter(l => l && l.url_lote && !seen.has(l.fonte_id) && seen.add(l.fonte_id));
}

function linksPdfBrutos(html) {
  const set = new Set();
  const re = /https?:(?:\\\/|\\u002[fF]|\/)[^"'\\\s)]+\.pdf[^"'\\\s)]*/gi;
  let m; while ((m = re.exec(html)) !== null) set.add(m[0].replace(/\\u002[fF]/gi, '/').replace(/\\\//g, '/'));
  // relativos e cdn sem esquema
  const re2 = /["'](\/\/cdn\.grupolance[^"'\s]+\.pdf[^"'\s]*|\/[^"'\s]+\.pdf[^"'\s]*)["']/gi;
  while ((m = re2.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

async function main() {
  const lotes = await escolherLotes();
  if (!lotes.length) { console.log('Nenhum lote para sondar.'); return; }
  console.log(`Sondando ${lotes.length} lote(s) do Grupo Lance no navegador real.\n`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  try {
    for (const l of lotes) {
      const nAnx = Array.isArray(l.anexos) ? l.anexos.length : 0;
      console.log(`\n════ ${l.fonte_id}  (anexos no banco: ${nAnx})`);
      console.log(`URL: ${l.url_lote}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
      try {
        const resp = await page.goto(l.url_lote, { waitUntil: 'networkidle2', timeout: 40000 });
        console.log(`  HTTP: ${resp?.status()}`);
        // dá tempo extra para docs montados por JS / lazy
        await new Promise(r => setTimeout(r, 2500));
        const html = await page.content();
        const temDocsTexto = /documenta[çc][ãa]o|documentos/i.test(html);
        console.log(`  "Documentos" no DOM: ${temDocsTexto}  |  tamanho HTML: ${html.length}b`);

        const brutos = linksPdfBrutos(html);
        console.log(`  PDFs no HTML (regex amplo): ${brutos.length}`);
        brutos.slice(0, 12).forEach(u => console.log(`     · ${u.slice(0, 140)}`));

        const docs = vasculharDocumentos(html, l.url_lote, null);
        console.log(`  vasculharDocumentos → anexos=${docs.anexos.length} matricula=${!!docs.matricula} edital=${!!docs.edital} laudo=${!!docs.laudo}`);
        docs.anexos.slice(0, 12).forEach(a => console.log(`     [${a.tipo}] ${a.nome} → ${String(a.url).slice(0, 120)}`));

        // Docs atrás de aba/botão? conta elementos clicáveis citando documento
        const clicaveis = await page.evaluate(() => {
          const kw = /documento|matr[ií]cul|edital|laudo|avalia|processo|an[aá]lise/i;
          const els = [...document.querySelectorAll('a,button,li,div[role="tab"],[data-tab],[data-toggle]')];
          return els.filter(e => kw.test((e.textContent || '') + ' ' + (e.getAttribute('href') || '') + ' ' + (e.className || ''))).length;
        }).catch(() => -1);
        console.log(`  elementos clicáveis citando documento/matrícula: ${clicaveis}`);

        // Trecho ao redor de "Documentos" para revelar a estrutura real do DOM
        const idx = html.search(/documenta[çc][ãa]o|documentos/i);
        if (idx >= 0) {
          const trecho = html.slice(Math.max(0, idx - 80), idx + 700).replace(/\s+/g, ' ').trim();
          console.log(`  DOM ~"Documentos": ${trecho.slice(0, 600)}`);
        }
      } catch (e) {
        console.log(`  ERRO ao abrir: ${e.message}`);
      } finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log('\nFim da sonda.');
}

main().catch((e) => { console.error(e); process.exit(1); });
