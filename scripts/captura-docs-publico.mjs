/**
 * Backfill GENÉRICO de documentos PÚBLICOS por leiloeiro (SEM login).
 *
 * Para fontes cujos documentos (edital/matrícula/laudo/regras) são PDFs públicos no
 * CDN — confirmado pelo recon (`recon-docs-leiloeiro.yml`): MEGA, BIASI, etc. Abre a
 * página do lote no navegador real (docs montados por JS aparecem), varre com o
 * `vasculharDocumentos` e grava `imoveis_leilao.anexos` (o campo do "0 anexos") +
 * `link_matricula`. Sem Storage/credencial — as URLs do CDN são públicas e estáveis.
 *
 * Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * Config: PUB_FONTE (ex.: MEGA), PUB_LOTE (default 120).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { vasculharDocumentos } from '../api/_doc-scan.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];
const FONTE = (process.env.PUB_FONTE || '').toUpperCase();
const LOTE = Number(process.env.PUB_LOTE || 120);
const DEADLINE_MS = Number(process.env.PUB_DEADLINE_MS || 25 * 60 * 1000);

async function alvos() {
  const { data, error } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital, link_foto')
    .eq('fonte', FONTE).eq('ativo', true)
    .or('anexos.is.null,anexos.eq.[]')
    .order('criado_em', { ascending: false })
    .limit(1000);
  if (error) { console.error(error.message); process.exit(1); }
  return (data || [])
    .map(l => ({ ...l, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page))
    .slice(0, LOTE);
}

async function main() {
  if (!FONTE) { console.error('Defina PUB_FONTE'); process.exit(1); }
  console.log(`\n📄 Backfill público ${FONTE} — ${new Date().toISOString()}`);
  const lotes = await alvos();
  if (!lotes.length) { console.log(`${FONTE}: nenhum lote pendente (sem anexos) com página.`); return; }
  console.log(`${lotes.length} lote(s) para tentar (cap ${LOTE}).\n`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const fim = Date.now() + DEADLINE_MS;
  let ok = 0, semDoc = 0, erro = 0, comMat = 0;
  try {
    for (const l of lotes) {
      if (Date.now() > fim) { console.log('  deadline atingido — resto fica p/ a próxima rodada'); break; }
      try {
        await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 1200));
        const html = await page.content();
        const docs = vasculharDocumentos(html, l.page, l.link_foto || null);
        if (!docs.anexos.length) { semDoc++; console.log(`- ${l.fonte_id}: sem documentos na página`); continue; }
        const upd = { anexos: docs.anexos };
        if (docs.matricula) { upd.link_matricula = docs.matricula; comMat++; }
        const { error } = await supabase.from('imoveis_leilao').update(upd).eq('id', l.id);
        if (error) { erro++; console.log(`- ${l.fonte_id}: erro ao gravar ${error.message}`); continue; }
        ok++;
        console.log(`✓ ${l.fonte_id}: ${docs.anexos.length} doc(s) [${docs.anexos.map(a => a.tipo).join(', ')}]${docs.matricula ? ' +matrícula' : ''}`);
      } catch (e) { erro++; console.log(`- ${l.fonte_id}: erro ${e.message}`); }
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(`\n${FONTE} — resultado: ${ok} enriquecido(s) · ${comMat} com matrícula · ${semDoc} sem doc · ${erro} erro(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
