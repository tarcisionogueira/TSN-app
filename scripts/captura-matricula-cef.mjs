/**
 * Captura automática da matrícula CEF.
 * Lê a fila `cef_matricula_fila` (status=pendente), abre o imóvel no site da Caixa
 * via Puppeteer (mesma sessão que já usamos para fotos), captura a matrícula em PDF,
 * sobe no Storage (bucket 'documentos') e registra em `imovel_anexos` (tipo=matricula).
 * A IA (processar-analise) passa a processar sem upload manual.
 *
 * Roda no GitHub Actions (egress liberado). Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { Buffer } from 'buffer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.MATRICULA_LOTE || 25);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// CPF válido gerado (descartável) — usado só se o site exigir o formulário de busca.
function gerarCPF() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join('');
}

async function capturar(page, hdniip) {
  const detalhe = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${hdniip}`;
  const matricula = `https://venda-imoveis.caixa.gov.br/sistema/matricula.asp?hdniip=${hdniip}`;
  // 1) Visita o detalhe (estabelece cookies/sessão), como o foto-cef já faz.
  await page.goto(detalhe, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  // 2) Abre a matrícula na mesma sessão.
  const resp = await page.goto(matricula, { waitUntil: 'networkidle2', timeout: 30000 });
  const ct = (resp?.headers()?.['content-type'] || '').toLowerCase();

  if (ct.includes('pdf')) {
    const buf = Buffer.from(await resp.buffer());
    if (buf.length > 1000) return { buffer: buf, mime: 'application/pdf' };
  }
  // HTML: valida que não é página de erro/sem matrícula, e imprime em PDF.
  const txt = (await page.evaluate(() => document.body?.innerText || '')).toLowerCase();
  if (/n[aã]o encontrad|indispon[ií]vel|erro|sess[aã]o expirad/.test(txt) && txt.length < 400) {
    return { erro: 'pagina_sem_matricula' };
  }
  const pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } }));
  if (pdf.length < 2000) return { erro: 'pdf_vazio' };
  return { buffer: pdf, mime: 'application/pdf' };
}

async function salvarAnexo(imovelId, buffer) {
  const path = `casos/${imovelId}/matricula_cef_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  // upsert por (imovel_id, tipo) — substitui matrícula anterior
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  const row = { imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula (CEF, automática).pdf', url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
}

async function main() {
  const { data: fila } = await supabase.from('cef_matricula_fila').select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(LOTE);
  if (!fila?.length) { console.log('Fila vazia.'); return; }
  console.log(`Processando ${fila.length} matrícula(s) CEF...`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  let ok = 0, erros = 0;

  for (const item of fila) {
    await supabase.from('cef_matricula_fila').update({ status: 'processando', tentativas: (item.tentativas || 0) + 1 }).eq('id', item.id);
    try {
      const r = await capturar(page, item.hdniip);
      if (r.erro || !r.buffer) throw new Error(r.erro || 'sem_conteudo');
      await salvarAnexo(item.imovel_id, r.buffer);
      await supabase.from('cef_matricula_fila').update({ status: 'ok', erro: null, processado_em: new Date().toISOString() }).eq('id', item.id);
      ok++;
      console.log(`✓ ${item.imovel_id}`);
    } catch (e) {
      await supabase.from('cef_matricula_fila').update({ status: 'erro', erro: String(e.message).slice(0, 300), processado_em: new Date().toISOString() }).eq('id', item.id);
      erros++;
      console.log(`✗ ${item.imovel_id}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  await browser.close();
  console.log(`Concluído: ${ok} ok, ${erros} erro(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
