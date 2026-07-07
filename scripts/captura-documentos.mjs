/**
 * Captura GENÉRICA de documentos por navegador real (qualquer leiloeiro que não a
 * Caixa — essa tem o script próprio captura-matricula-cef.mjs). Lê `documentos_fila`
 * (status=pendente), abre a página do lote com Puppeteer, ENCONTRA e BAIXA os PDFs
 * (edital/matrícula/laudo/regras) por 2 caminhos:
 *   1) interceptação de rede: qualquer resposta application/pdf que a página carregar;
 *   2) varredura de links <a href="*.pdf"> e botões de download na página renderizada.
 * Guarda no Storage (bucket 'documentos') e registra em `imovel_anexos` (com
 * storage_path) — que a análise documental já lê PRIMEIRO. Roda no GitHub Actions.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { Buffer } from 'buffer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.DOCS_LOTE || 15);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ehUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v);
// Classifica o documento pelo nome/URL para gravar o tipo certo.
function classificar(url, nome = '') {
  const s = `${url} ${nome}`.toLowerCase();
  if (/matric/.test(s)) return 'matricula';
  if (/edital/.test(s)) return 'edital';
  if (/laudo|avalia/.test(s)) return 'laudo';
  if (/regras|condi|como.?comprar/.test(s)) return 'regras_venda';
  return 'outro';
}

async function salvarAnexo(imovelId, buffer, tipo, nome) {
  const path = `casos/${imovelId}/${tipo}_auto_${Date.now()}.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo, nome, url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', tipo).limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
}

async function baixarPdf(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (!resp || resp.status() >= 400) return null;
    const ct = (resp.headers()['content-type'] || '').toLowerCase();
    if (!ct.includes('pdf')) return null;
    const buf = Buffer.from(await resp.buffer());
    return buf.length > 1500 ? buf : null;
  } catch { return null; }
}

async function processar(browser, item) {
  const { data: im } = await supabase.from('imoveis_leilao')
    .select('link_edital, link_matricula, link_regras_venda, anexos, fonte').eq('id', item.imovel_id).single();
  if (!im) throw new Error('imovel_nao_encontrado');

  const page = await browser.newPage();
  await page.setUserAgent(UA);

  // 1) Interceptação: guarda qualquer PDF que a página carregar sozinha.
  const pdfsRede = [];
  page.on('response', async (resp) => {
    try {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (ct.includes('pdf') && resp.status() < 400) {
        const buf = Buffer.from(await resp.buffer());
        if (buf.length > 1500) pdfsRede.push({ url: resp.url(), buf });
      }
    } catch { /* ignora */ }
  });

  const capturados = [];
  const salvos = new Set();
  const salvar = async (buf, url, nome) => {
    const tipo = classificar(url, nome);
    if (salvos.has(tipo)) return; // um por tipo
    await salvarAnexo(item.imovel_id, buf, tipo, nome || `${tipo}.pdf`);
    salvos.add(tipo); capturados.push(tipo);
  };

  // Abre a página do lote (link_edital costuma ser a página; ou os links diretos).
  const paginaLote = ehUrl(im.link_edital) ? im.link_edital : (ehUrl(im.link_regras_venda) ? im.link_regras_venda : null);
  if (paginaLote) {
    try { await page.goto(paginaLote, { waitUntil: 'networkidle2', timeout: 30000 }); await new Promise(r => setTimeout(r, 1500)); } catch { /* segue */ }
  }

  // 2) Links de PDF na página renderizada.
  let linksPdf = [];
  try {
    linksPdf = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ href: a.href, txt: (a.textContent || '').trim().slice(0, 80) }))
      .filter(x => /\.pdf(\?|#|$)/i.test(x.href) || /edital|matr[ií]cula|laudo|documento|anexo/i.test(x.txt)));
  } catch { /* sem links */ }

  // Guarda os PDFs que já vieram pela rede.
  for (const p of pdfsRede) { try { await salvar(p.buf, p.url, ''); } catch { /* */ } }
  // Baixa os links de PDF encontrados (até 4 tipos).
  for (const l of linksPdf) {
    if (salvos.size >= 4) break;
    if (!/\.pdf(\?|#|$)/i.test(l.href)) continue;
    const buf = await baixarPdf(page, l.href);
    if (buf) { try { await salvar(buf, l.href, l.txt); } catch { /* */ } }
  }
  // Também os anexos que o scrape já tinha registrado como URL (baixa e guarda).
  for (const a of (Array.isArray(im.anexos) ? im.anexos : [])) {
    if (salvos.size >= 4) break;
    if (!ehUrl(a?.url)) continue;
    const buf = await baixarPdf(page, a.url);
    if (buf) { try { await salvar(buf, a.url, a.nome || ''); } catch { /* */ } }
  }

  await page.close();
  if (!capturados.length) throw new Error('nenhum_documento_encontrado');
  return capturados;
}

async function main() {
  const { data: fila } = await supabase.from('documentos_fila').select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(LOTE);
  if (!fila?.length) { console.log('Fila vazia.'); return; }
  console.log(`Processando ${fila.length} imóvel(is)...`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let ok = 0, erros = 0;
  for (const item of fila) {
    await supabase.from('documentos_fila').update({ status: 'processando', tentativas: (item.tentativas || 0) + 1 }).eq('imovel_id', item.imovel_id);
    try {
      const docs = await processar(browser, item);
      await supabase.from('documentos_fila').update({ status: 'ok', erro: null, processado_em: new Date().toISOString() }).eq('imovel_id', item.imovel_id);
      ok++; console.log(`✓ ${item.imovel_id}: ${docs.join(', ')}`);
    } catch (e) {
      await supabase.from('documentos_fila').update({ status: 'erro', erro: String(e.message).slice(0, 300), processado_em: new Date().toISOString() }).eq('imovel_id', item.imovel_id);
      erros++; console.log(`✗ ${item.imovel_id}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  await browser.close();
  console.log(`Concluído: ${ok} ok, ${erros} erro(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
