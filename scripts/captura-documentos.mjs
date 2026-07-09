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

const ehPdfBuf = (buf, ct) => buf && buf.length > 1500 && ((ct || '').includes('pdf') || buf.slice(0, 5).toString('latin1') === '%PDF-');

async function baixarPdf(page, url, referer) {
  // 1) Node fetch (SEM CORS) — funciona cross-origin, essencial para os PDFs que
  //    ficam num CDN (ex.: cdn1.megaleiloes.com.br), onde o fetch da página é
  //    bloqueado por CORS. page.goto() num PDF dá net::ERR_ABORTED, por isso não é usado.
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (ehPdfBuf(buf, r.headers.get('content-type'))) return buf;
    }
  } catch { /* tenta pela página */ }
  // 2) Fetch DENTRO da página (usa a sessão validada) — cobre PDFs same-origin que a
  //    origem só serve com cookie/sessão.
  try {
    const res = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return null;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return { ct, b64: btoa(bin), len: bytes.length };
      } catch { return null; }
    }, url);
    if (res && res.len >= 1500) { const buf = Buffer.from(res.b64, 'base64'); if (ehPdfBuf(buf, res.ct)) return buf; }
  } catch { /* */ }
  return null;
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
    try {
      await page.goto(paginaLote, { waitUntil: 'networkidle2', timeout: 45000 });
      // Anti-bot (Cloudflare "just a moment"): espera o desafio JS resolver e o
      // conteúdo real carregar, senão varremos a página de bloqueio (0 documentos).
      await page.waitForFunction(() => {
        const t = document.body?.innerText || '';
        if (/just a moment|um momento|verificando|attention required|checking your browser/i.test(t)) return false;
        return document.querySelectorAll('a[href]').length > 5;
      }, { timeout: 12000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    } catch { /* segue */ }
  }

  // 2) Links de PDF/documento na página renderizada (rótulo OU extensão).
  let linksPdf = [];
  try {
    linksPdf = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ href: a.href, txt: (a.textContent || '').trim().slice(0, 80) }))
      .filter(x => /\.pdf(\?|#|$)/i.test(x.href) || /edital|matr[ií]cula|laudo|documento|anexo|processo|arquivo|download/i.test(x.txt + ' ' + x.href)));
  } catch { /* sem links */ }

  // DIAGNÓSTICO p/ calibrar leiloeiros anti-bot (aparece nos logs do GitHub Actions).
  try {
    const diag = await page.evaluate(() => ({ title: document.title.slice(0, 70), len: (document.body?.innerText || '').length }));
    console.log(`[docs] ${item.imovel_id} ${im.fonte || ''}: title="${diag.title}" bodyLen=${diag.len} candidatos=${linksPdf.length} rede=${pdfsRede.length}${linksPdf.length ? ' :: ' + linksPdf.slice(0, 6).map(l => `${l.txt}->${l.href}`).join(' | ').slice(0, 500) : ''}`);
  } catch { /* */ }

  // Guarda os PDFs que já vieram pela rede.
  for (const p of pdfsRede) { try { await salvar(p.buf, p.url, ''); } catch { /* */ } }
  // Baixa os candidatos: .pdf direto OU link ROTULADO como documento (mesmo sem a
  // extensão .pdf — muitos leiloeiros servem o edital/matrícula por uma rota).
  // baixarPdf só salva se a resposta for REALMENTE application/pdf (filtra HTML/rotas).
  for (const l of linksPdf) {
    if (salvos.size >= 4) break;
    const alvo = l.txt + ' ' + l.href;
    const ehPdfHref = /\.pdf(\?|#|$)/i.test(l.href);
    const ehDocTxt = /edital|matr[ií]cula|laudo|documento|anexo|processo|arquivo|download/i.test(alvo);
    // Ignora documentos GENÉRICOS do site (não são do lote): modelo de proposta,
    // "como comprar", termos, cadastro, política — evita salvar lixo como "edital".
    const ehGenerico = /modelo|proposta|como.?comprar|termos|pol[ií]tica|privacidade|cadastr|manual|passo.?a.?passo/i.test(alvo);
    if ((!ehPdfHref && !ehDocTxt) || ehGenerico) continue;
    const buf = await baixarPdf(page, l.href, paginaLote);
    if (buf) { try { await salvar(buf, l.href, l.txt); } catch { /* */ } }
  }
  // Também os anexos que o scrape já tinha registrado como URL (baixa e guarda).
  for (const a of (Array.isArray(im.anexos) ? im.anexos : [])) {
    if (salvos.size >= 4) break;
    if (!ehUrl(a?.url)) continue;
    const buf = await baixarPdf(page, a.url, paginaLote);
    if (buf) { try { await salvar(buf, a.url, a.nome || ''); } catch { /* */ } }
  }

  await page.close();
  if (!capturados.length) throw new Error('nenhum_documento_encontrado');
  return capturados;
}

async function main() {
  // Processa PENDENTES e re-tenta ERROS transitórios (até 4 tentativas) — assim uma
  // falha momentânea (fonte instável) não deixa o lote sem documentos para sempre.
  const { data: fila } = await supabase.from('documentos_fila')
    .select('*')
    .or('status.eq.pendente,and(status.eq.erro,tentativas.lt.4)')
    .order('criado_em', { ascending: true }).limit(LOTE);
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
