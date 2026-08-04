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
import https from 'https';

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

// BAIXA um PDF ESTÁTICO por HTTP puro — sem navegador.
//
// POR QUÊ: matrícula e edital da Caixa são arquivos estáticos, e o navegador é o jeito ERRADO
// de buscá-los. O Chrome headless não "navega" para um PDF: ele baixa. Quando o content-type
// não vem exatamente como `application/pdf` (a Caixa às vezes manda octet-stream), o
// capturarUrl caía no passo 4 e IMPRIMIA a tela como PDF — gerando um arquivo pequeno, sem
// camada de texto, que a IA lê como vazio. Medido em 04/08: o edital do lote de Cuiabá foi
// salvo com 63 KB enquanto o PDF real tem 738 KB. Um "documento" desses é PIOR que nenhum:
// o relatório parece ter o edital e não tem.
//
// O download direto (node:https) devolve o arquivo íntegro — é o mesmo cliente que o scraper
// diário usa e que o recon confirmou (HTTP 200, application/pdf, 755.730 bytes).
// DIAGNÓSTICO OBRIGATÓRIO: toda recusa é LOGADA com o motivo (status, content-type, tamanho,
// primeiros bytes). Uma captura que devolve null em silêncio é justamente o que fez este bug
// sobreviver meses — o lote era marcado como concluído sem o documento e ninguém via.
function baixarPdf(url, rotulo = 'doc', hops = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        // Cabeçalhos IDÊNTICOS aos do recon que comprovadamente baixou o edital
        // (HTTP 200, application/pdf, 755.730 bytes). UA enxuto — o UA completo de Chrome
        // com fingerprint de TLS que não é de Chrome é sinal clássico de bot.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/csv,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Referer: 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        return baixarPdf(new URL(res.headers.location, url).toString(), rotulo, hops + 1).then(resolve);
      }
      const ct = res.headers['content-type'] || '';
      if (res.statusCode !== 200) {
        res.resume();
        console.log(`    ⚠️ ${rotulo}: HTTP ${res.statusCode} em ${url}`);
        return resolve(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Só aceita PDF DE VERDADE (assinatura %PDF-). Assim uma interstitial do Radware ou
        // uma página de erro nunca é salva como se fosse o documento.
        if (buf.length > 2000 && buf.subarray(0, 5).toString() === '%PDF-') return resolve(buf);
        const amostra = buf.subarray(0, 60).toString('latin1').replace(/\s+/g, ' ');
        console.log(`    ⚠️ ${rotulo}: resposta não é PDF — ct=${ct} bytes=${buf.length} início="${amostra}" url=${url}`);
        resolve(null);
      });
    });
    req.on('error', (e) => { console.log(`    ⚠️ ${rotulo}: erro de rede ${String(e.message).slice(0, 80)} em ${url}`); resolve(null); });
    req.on('timeout', () => { req.destroy(); console.log(`    ⚠️ ${rotulo}: timeout em ${url}`); resolve(null); });
  });
}

// Navega para uma URL na sessão atual e devolve um PDF (response PDF direto ou página impressa).
// Para PDFs estáticos prefira `baixarPdf` — ver o comentário acima.
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
  //    Baixa por HTTP direto (não pelo navegador) — ver baixarPdf().
  const matri = (uf.length === 2 && num)
    ? await baixarPdf(`https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf`, 'matricula').catch(() => null)
    : null;
  if (matri) { await salvarAnexo(item.imovel_id, matri, 'matricula', 'Matrícula (CEF, automática).pdf'); capturados.push('matricula'); }

  // 2) Edital direto (quando o link_edital já é um PDF externo/real).
  //    Com o backfill (backfill-edital-cef.mjs) link_edital já é o PDF real na maior parte do
  //    acervo, então este é o caminho normal. PDF estático → download direto.
  if (ehUrl(imovel?.link_edital)) {
    const ed = await baixarPdf(imovel.link_edital, 'edital').catch(() => null);
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
            // PDF estático → download direto; só cai no navegador se não for um PDF
            // (alguns lotes judiciais linkam um .asp, que precisa ser renderizado).
            const m2 = await baixarPdf(matriculaPdf, 'matricula-pagina').catch(() => null)
                    || await capturarUrl(page, matriculaPdf).catch(() => null);
            if (m2) { await salvarAnexo(item.imovel_id, m2, 'matricula', 'Matrícula (CEF, automática).pdf'); capturados.push('matricula'); }
            await page.goto(detalheUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 600));
          }
        }
        // 3a) Edital em PDF linkado na página (se ainda não capturado). O edital COLETIVO
        //     da Caixa é /editais/E<A|L><NNNN><MMYY><UNID>.PDF (ver leiloeiro_conhecimento CEF).
        //     NUNCA pega a MATRÍCULA (/editais/matricula/…) como edital — foi a origem do
        //     bug "Edital abre matrícula" (removida a antiga heurística "qualquer PDF").
        //
        // CORRIGIDO 04/08 (recon na página VIVA, apto de Cuiabá `8555536754309`): a versão
        // anterior lia SÓ `a.href` — e a Caixa não põe o PDF no href. O link real é:
        //   <a href='#' onclick=javascript:ExibeDoc('/editais/EA00270326CPVERE.PDF')>
        //      <strong>Baixar edital e anexos</strong></a>
        // ou seja, href='#' e o caminho dentro do ONCLICK. Resultado: `a.href` virava
        // ".../detalhe-imovel.asp#", nenhum seletor casava, e o lote era gravado como
        // capturado (matrícula + condições) SEM edital — silenciosamente. Era por isso que
        // só 2 dos 27.278 lotes CEF tinham anexo de edital. Agora lê onclick E href.
        if (!capturados.includes('edital')) {
          const editalPdf = await page.evaluate(() => {
            const EXCLUI = /\/editais\/matricula\/|regras-?VOL/i;                 // matrícula e "como comprar" não são o edital
            const acha = (txt) => {
              const m = String(txt || '').match(/(?:https?:\/\/[^\s"'<>()]*)?\/editais\/[^\s"'<>()]+\.pdf/i);
              return m && !EXCLUI.test(m[0]) ? m[0] : null;
            };
            for (const a of document.querySelectorAll('a')) {                     // âncora rotulada "edital": olha onclick ANTES do href
              if (!/edital/i.test(a.textContent || '')) continue;
              const u = acha(a.getAttribute('onclick')) || acha(a.getAttribute('href'));
              if (u) return u;
            }
            const m = document.documentElement.outerHTML.match(/\/editais\/E[A-Z][^\s"'<>()]*\.pdf/i); // padrão do edital coletivo
            return m && !EXCLUI.test(m[0]) ? m[0] : null;
          }).then(u => (u ? new URL(u, 'https://venda-imoveis.caixa.gov.br').toString() : null));
          if (editalPdf) {
            const ed = await baixarPdf(editalPdf, 'edital-pagina').catch(() => null);   // PDF estático → download direto
            if (ed) { await salvarAnexo(item.imovel_id, ed, 'edital', 'Edital (CEF, automático).pdf'); capturados.push('edital'); }
            // Grava a URL REAL do edital em link_edital → o botão "Edital" abre o PDF direto
            // no navegador do usuário (hotlink, IP residencial atendido pela Caixa; sem custo
            // de Storage). Antes link_edital era só a página do lote ("Acessar leiloeiro").
            await supabase.from('imoveis_leilao').update({ link_edital: editalPdf }).eq('id', item.imovel_id).then(() => {}, () => {});
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
  // FAXINA DE ÓRFÃOS: uma linha marcada 'processando' que nunca volta (o job morreu no meio,
  // timeout do Actions, deploy) fica INVISÍVEL para sempre — a consulta abaixo só pega
  // 'pendente'. Sem retry, sem erro, sem alarme. Havia linha presa desde 07/07. Devolve para
  // a fila o que está 'processando' há mais de 2h (uma rodada leva minutos).
  const limite = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: presos } = await supabase.from('cef_matricula_fila')
    .update({ status: 'pendente', erro: 'retomado apos ficar preso em processando' })
    .eq('status', 'processando').lt('criado_em', limite).select('id');
  if (presos?.length) console.log(`↻ ${presos.length} linha(s) presa(s) em 'processando' devolvida(s) à fila.`);

  const { data: fila } = await supabase.from('cef_matricula_fila').select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(LOTE);
  if (!fila?.length) { console.log('Fila vazia.'); return; }
  console.log(`Processando ${fila.length} imóvel(is) CEF...`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  let ok = 0, erros = 0, reagendados = 0, semEdital = 0;

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
      // O total NÃO pode contar um reagendamento como sucesso: era assim que uma rodada em
      // que vários lotes falharam em obter a matrícula ainda imprimia "N ok, 0 erro(s)".
      if (temMatricula) ok++; else reagendados++;
      if (!docs.includes('edital')) semEdital++;
      console.log(`${temMatricula ? '✓' : '⟳'} ${item.imovel_id}: ${docs.join(', ') || 'nada'}${temMatricula ? '' : ` (sem matrícula, tent ${tent})`}${docs.includes('edital') ? '' : ' [SEM EDITAL]'}`);
    } catch (e) {
      await supabase.from('cef_matricula_fila').update({ status: 'erro', erro: String(e.message).slice(0, 300), processado_em: new Date().toISOString() }).eq('id', item.id);
      erros++;
      console.log(`✗ ${item.imovel_id}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  await browser.close();
  console.log(`Concluído: ${ok} com matrícula, ${reagendados} reagendado(s) sem matrícula, ${erros} erro(s), ${semEdital} sem edital.`);
}

main().catch(e => { console.error(e); process.exit(1); });
