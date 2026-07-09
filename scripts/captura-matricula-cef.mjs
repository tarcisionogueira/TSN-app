/**
 * Captura automática dos DOCUMENTOS CEF (matrícula + edital/regra de venda online).
 * Lê a fila `cef_matricula_fila` (status=pendente), abre o imóvel no site da Caixa
 * via Puppeteer (mesma sessão que já usamos para fotos), captura os documentos em PDF,
 * sobe no Storage (bucket 'documentos') e registra em `imovel_anexos`
 * (tipo=matricula / edital / regras_venda). A IA (processar-analise) processa sem upload manual.
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
const ehUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v) && !/detalhe-imovel\.asp/i.test(v);

// CPF válido gerado (descartável) — usado só se o site exigir o formulário de busca.
function gerarCPF() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  return [...n, d1, d2].join('');
}

// Navega para uma URL na sessão atual e devolve um PDF (response PDF direto ou página impressa).
async function capturarUrl(page, url) {
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const status = resp?.status() || 0;
  // 1) Resposta PDF direta da Caixa
  const ct = (resp?.headers()?.['content-type'] || '').toLowerCase();
  if (ct.includes('pdf')) {
    const buf = Buffer.from(await resp.buffer());
    if (buf.length > 1000) return buf;
  }
  // 2) HTTP de erro (ex.: matricula.asp?hdniip= retorna 404 do IIS) → NÃO captura.
  //    Sem essa guarda, a página de erro 404 era impressa como se fosse a matrícula.
  if (status >= 400) return null;
  // 3) Página de erro/indisponível (IIS em inglês, Caixa, sessão) — não vira "documento".
  //    Detecta por título + corpo, sem limite de tamanho (o erro do IIS é longo).
  const info = await page.evaluate(() => ({
    txt: (document.body?.innerText || '').slice(0, 4000),
    title: document.title || '',
  }));
  const hay = `${info.title}\n${info.txt}`.toLowerCase();
  if (/http error|server error|404\.0|not found|n[aã]o encontrad|indispon[ií]vel|sess[aã]o expirad|p[aá]gina n[aã]o (foi )?encontrad|erro ao/.test(hay)) return null;
  // 4) Conteúdo aparenta válido → imprime a página como PDF
  const pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } }));
  return pdf.length > 2000 ? pdf : null;
}

async function salvarAnexo(imovelId, buffer, tipo, nome) {
  const path = `casos/${imovelId}/${tipo}_cef_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo, nome, url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', tipo).limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
}

async function processar(page, item) {
  const { data: imovel } = await supabase.from('imoveis_leilao').select('link_edital, link_regras_venda, estado').eq('id', item.imovel_id).single();
  const capturados = [];

  // 1) Matrícula (sempre): PDF estático em /editais/matricula/<UF>/<numero>.pdf.
  //    O matricula.asp?hdniip= foi REMOVIDO pela Caixa (HTTP 404). O número do imóvel
  //    é o hdniip da fila; a UF vem do imóvel.
  const uf = String(imovel?.estado || '').trim().toUpperCase();
  const num = String(item.hdniip || '').replace(/\D/g, '');
  const matri = (uf.length === 2 && num)
    ? await capturarUrl(page, `https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf`).catch(() => null)
    : null;
  if (matri) { await salvarAnexo(item.imovel_id, matri, 'matricula', 'Matrícula (CEF, automática).pdf'); capturados.push('matricula'); }

  // 2) Edital direto (quando o link_edital já é um PDF externo/real).
  if (ehUrl(imovel?.link_edital)) {
    const ed = await capturarUrl(page, imovel.link_edital).catch(() => null);
    if (ed) { await salvarAnexo(item.imovel_id, ed, 'edital', 'Edital (CEF, automático).pdf'); capturados.push('edital'); }
  }

  // 3) Página de DETALHE da Caixa (detalhe-imovel.asp): é onde ficam o EDITAL em PDF
  //    e as CONDIÇÕES DE VENDA (modalidade, valores, forma de pagamento, ocupação).
  //    Antes o script pulava isso porque a `ehUrl` rejeita a detalhe-imovel.asp —
  //    então o edital/regras nunca eram capturados e a análise só via a matrícula.
  const detalheUrl = num
    ? `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${num}`
    : (imovel?.link_regras_venda || imovel?.link_edital || null);
  if (detalheUrl) {
    try {
      const resp = await page.goto(detalheUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      if (resp && resp.status() < 400) {
        await new Promise(r => setTimeout(r, 1200));
        // 3a-bis) MATRÍCULA em PDF linkada na página de detalhe (ROTA ALTERNATIVA):
        //    a URL estática /editais/matricula/<UF>/<num>.pdf NÃO existe para muitos
        //    lotes JUDICIAIS — nesses casos a matrícula fica como link na página do
        //    imóvel. Sem esta rota, o lote judicial ficava sem a matrícula (só regras).
        if (!capturados.includes('matricula')) {
          const matriculaPdf = await page.evaluate(() => {
            const as = Array.from(document.querySelectorAll('a[href]'));
            const rot = a => `${a.href} ${a.textContent || ''}`;
            // Detecção AMPLA (a matrícula da Caixa aparece com formatos variados de link):
            const rotulada =
                 as.find(a => /matr[íi]cula/i.test(rot(a)) && /\.pdf(\?|#|$)/i.test(a.href))       // PDF rotulado matrícula
              || as.find(a => /\/matricula\//i.test(a.href) && /\.pdf(\?|#|$)/i.test(a.href))      // caminho /matricula/<uf>/<n>.pdf
              || as.find(a => /matr[íi]cula/i.test(rot(a)) && /\.(pdf|asp)(\?|#|$)/i.test(a.href))  // .asp/.pdf rotulado
              || as.find(a => /matr[íi]cula/i.test(a.textContent || '') && a.href);                 // qualquer link rotulado matrícula
            return rotulada ? rotulada.href : null;
          });
          if (matriculaPdf) {
            const m2 = await capturarUrl(page, matriculaPdf).catch(() => null);
            if (m2) { await salvarAnexo(item.imovel_id, m2, 'matricula', 'Matrícula (CEF, automática).pdf'); capturados.push('matricula'); }
            await page.goto(detalheUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 600));
          }
        }
        // 3a) Edital em PDF linkado na página (se ainda não capturado).
        if (!capturados.includes('edital')) {
          const editalPdf = await page.evaluate(() => {
            const as = Array.from(document.querySelectorAll('a[href]'));
            const hit = as.find(a => /\.pdf(\?|#|$)/i.test(a.href) && /edital/i.test(`${a.href} ${a.textContent || ''}`))
                     || as.find(a => /\.pdf(\?|#|$)/i.test(a.href));
            return hit ? hit.href : null;
          });
          if (editalPdf) {
            const ed = await capturarUrl(page, editalPdf).catch(() => null);
            if (ed) { await salvarAnexo(item.imovel_id, ed, 'edital', 'Edital (CEF, automático).pdf'); capturados.push('edital'); }
            await page.goto(detalheUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 600));
          }
        }
        // 3b) Condições de venda: imprime a própria página de detalhe como PDF.
        if (!capturados.includes('regras_venda')) {
          const cond = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } }));
          if (cond.length > 2000) { await salvarAnexo(item.imovel_id, cond, 'regras_venda', 'Condições de venda (CEF, automático).pdf'); capturados.push('regras_venda'); }
        }
      }
    } catch { /* segue com o que já capturou */ }
  }

  if (!capturados.length) throw new Error('nenhum_documento_capturado');
  return capturados;
}

async function main() {
  const { data: fila } = await supabase.from('cef_matricula_fila').select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(LOTE);
  if (!fila?.length) { console.log('Fila vazia.'); return; }
  console.log(`Processando ${fila.length} imóvel(is) CEF...`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  let ok = 0, erros = 0;

  for (const item of fila) {
    await supabase.from('cef_matricula_fila').update({ status: 'processando', tentativas: (item.tentativas || 0) + 1 }).eq('id', item.id);
    try {
      const docs = await processar(page, item);
      const temMatricula = docs.includes('matricula');
      const tent = (item.tentativas || 0) + 1;
      if (temMatricula || tent >= 4) {
        // Concluído: com a matrícula (ideal) OU após esgotar as tentativas de obtê-la
        // (segue com edital/condições; a matrícula vira diligência do analista).
        await supabase.from('cef_matricula_fila').update({
          status: temMatricula ? 'ok' : 'parcial',
          erro: temMatricula ? null : 'matricula nao localizada apos varias tentativas',
          processado_em: new Date().toISOString(),
        }).eq('id', item.id);
      } else {
        // Faltou a MATRÍCULA (documento central) → mantém PENDENTE para nova tentativa
        // na próxima rodada do cron (10 min). Garante que não paramos sem a matrícula.
        await supabase.from('cef_matricula_fila').update({ status: 'pendente', erro: `sem matricula (tentativa ${tent})` }).eq('id', item.id);
      }
      ok++;
      console.log(`${temMatricula ? '✓' : '⟳'} ${item.imovel_id}: ${docs.join(', ') || 'nada'}${temMatricula ? '' : ` (sem matrícula, tent ${tent})`}`);
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
