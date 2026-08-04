/**
 * RECON — EDITAL DA CAIXA (venda-imoveis.caixa.gov.br)
 *
 * POR QUÊ: o documental de um apto em Cuiabá/MT (`cef_8555536754309`) saiu "sem acesso ao
 * edital", e a página do lote EXIBE "Baixar edital e anexos" + "Edital: 0027/0326 - CPVE/RE".
 * A captura por navegador rodou nesse lote, gravou matrícula e condições de venda, e NÃO
 * achou o edital — o seletor de âncora erra o alvo.
 *
 * ACHADO DA 1ª RODADA: com `fetch()` (undici) a Caixa devolve HTTP 200 com a interstitial do
 * **Radware Bot Manager CAPTCHA** — inclusive para o CSV, que o scraper diário lê sem
 * problema nenhum (log de 03/08: 27 UFs, 27.278 lotes, zero erro). A diferença entre os dois
 * é o CLIENTE: o scraper usa `https.get` (node:https) e o recon usava `fetch`. O Radware
 * separa os dois — provavelmente pelo fingerprint de TLS/ALPN. Esta rodada usa o MESMO
 * cliente do scraper e compara os dois lado a lado para PROVAR o discriminador.
 *
 * CONFIRMADO NO LOG DO SCRAPER: o CSV oficial NÃO tem coluna de edital. Colunas reais:
 *   n do imovel · uf · cidade · bairro · endereco · preco · valor de avaliacao · desconto
 *   · financiamento · descricao · modalidade de venda · link de acesso
 * Ou seja, o edital só pode vir da PÁGINA do lote.
 *
 * HIPÓTESE: a URL do edital é FUNÇÃO do número impresso na página.
 *   "Edital: 0027/0326 - CPVE/RE" + licitação aberta → /editais/EA00270326CPVERE.PDF
 *   "Edital: 0035/0226 - CPA/RE"  + leilão            → /editais/EL00350226CPARE.PDF
 * (os 8 lotes do acervo com PDF real seguem exatamente esse formato). Se confirmar, o edital
 * deixa de depender de scraping de âncora: monta-se a URL. E como o edital da Caixa é
 * COLETIVO, poucos PDFs cobrem milhares de lotes.
 *
 * RODA NO GITHUB ACTIONS: a Caixa atende o IP do runner; o ambiente de dev é bloqueado.
 * Só LÊ e imprime — não grava nada.
 */
import https from 'https';

const B = 'https://venda-imoveis.caixa.gov.br';
const UA_SCRAPER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const NUM = process.env.RECON_NUM || '8555536754309';
const UF = process.env.RECON_UF || 'MT';

const linha = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);
const ehCaptcha = (txt) => /Radware|BotManager|__uzdbm_|Bot Manager CAPTCHA/i.test(txt || '');

// Cliente IDÊNTICO ao do scraper diário (node:https), que a Caixa atende.
function get(url, headers = {}, hops = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA_SCRAPER,
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/csv,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 4) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return get(next, headers, hops + 1).then(resolve);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        ct: res.headers['content-type'] || '',
        buffer: Buffer.concat(chunks),
      }));
    });
    req.on('error', (e) => resolve({ status: 0, ct: '', buffer: Buffer.alloc(0), erro: String(e.message).slice(0, 120) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ct: '', buffer: Buffer.alloc(0), erro: 'timeout' }); });
  });
}

// ─── 0) O discriminador: https.get vs fetch, na MESMA URL ─────────────────────
async function reconCliente() {
  linha('0) DISCRIMINADOR — node:https (scraper) vs fetch (undici), mesma URL');
  const url = `${B}/listaweb/Lista_imoveis_${UF}.csv`;
  const a = await get(url);
  const txtA = a.buffer.toString('latin1');
  console.log(`  node:https → HTTP ${a.status} ${a.ct} ${a.buffer.length}B  ${ehCaptcha(txtA) ? '⛔ CAPTCHA Radware' : '✅ conteúdo real'}`);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA_SCRAPER, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(25000) });
    const txtB = await r.text();
    console.log(`  fetch      → HTTP ${r.status} ${r.headers.get('content-type')} ${txtB.length}B  ${ehCaptcha(txtB) ? '⛔ CAPTCHA Radware' : '✅ conteúdo real'}`);
  } catch (e) { console.log(`  fetch      → erro ${String(e.message).slice(0, 90)}`); }
  if (!ehCaptcha(txtA)) console.log(`  Cabeçalho do CSV: ${txtA.split(/\r?\n/)[0]?.slice(0, 300)}`);
}

// ─── 1) A página do lote: onde está o "Baixar edital e anexos"? ────────────────
async function reconPagina() {
  linha(`1) PÁGINA DO LOTE — detalhe-imovel.asp (imóvel ${NUM})`);
  let html = null;
  for (const url of [`${B}/sistema/detalhe-imovel.asp?hdnimovel=${NUM}`, `${B}/sistema/detalhe-imovel.asp?hdniip=${NUM}`]) {
    const r = await get(url, { Referer: `${B}/sistema/busca-imovel.asp` });
    const t = r.buffer.toString('latin1');
    console.log(`  ${url}\n    → HTTP ${r.status} ${r.ct} ${r.buffer.length}B ${ehCaptcha(t) ? '⛔ CAPTCHA' : ''} ${r.erro || ''}`);
    if (r.status === 200 && !ehCaptcha(t) && t.length > 2000) { html = t; break; }
  }
  if (!html) { console.log('  ✗ não obtive o HTML REAL da página.'); return null; }

  const numEdital = html.match(/(\d{4})\s*\/\s*(\d{4})\s*-\s*([A-Z]{2,6}\s*\/\s*[A-Z]{2,4})/);
  console.log(`\n  Número do edital impresso: ${numEdital ? `${numEdital[1]}/${numEdital[2]} - ${numEdital[3]}` : '(não casou)'}`);

  console.log('\n  Ocorrências de "/editais/" no HTML CRU:');
  const vistos = new Set();
  for (const m of html.matchAll(/[^\s"'<>()]*\/editais\/[^\s"'<>()]+/gi)) {
    if (!vistos.has(m[0])) { vistos.add(m[0]); console.log(`    • ${m[0]}`); }
  }
  if (!vistos.size) console.log('    (nenhuma)');

  console.log('\n  Trechos ao redor de "edital" (href/onclick reais):');
  const re = /edital/gi; let m, n = 0;
  while ((m = re.exec(html)) && n < 10) {
    console.log(`    [${++n}] …${html.slice(Math.max(0, m.index - 300), m.index + 300).replace(/\s+/g, ' ')}…`);
    re.lastIndex = m.index + 450;
  }
  return numEdital;
}

// ─── 2) A hipótese: URL montada a partir do número do edital ───────────────────
async function reconUrlMontada(numEdital) {
  linha('2) HIPÓTESE — URL montada a partir do número do edital');
  const combos = [];
  if (numEdital) combos.push([numEdital[1], numEdital[2], numEdital[3].replace(/[^A-Z]/gi, '').toUpperCase()]);
  combos.push(['0027', '0326', 'CPVERE']); // do print enviado pelo dono
  for (const [nnnn, mmyy, unid] of combos) {
    for (const p of ['EA', 'EL']) {
      for (const ext of ['PDF', 'pdf']) {
        const u = `${B}/editais/${p}${nnnn}${mmyy}${unid}.${ext}`;
        const r = await get(u, { Referer: `${B}/sistema/detalhe-imovel.asp` });
        const cabecalho = r.buffer.slice(0, 5).toString();
        const ehPdf = r.status === 200 && (/pdf/i.test(r.ct) || cabecalho === '%PDF-');
        console.log(`  ${ehPdf ? '✓' : '·'} ${u} → HTTP ${r.status} ${r.ct} ${r.buffer.length}B ${ehPdf ? `(PDF REAL, ${(r.buffer.length / 1024).toFixed(0)} KB)` : ehCaptcha(r.buffer.toString('latin1')) ? '⛔CAPTCHA' : ''}`);
        if (ehPdf) return u;
      }
    }
  }
  console.log('  ✗ nenhum candidato retornou PDF.');
}

// ─── 3) Controle: os editais que o acervo JÁ tem respondem? ────────────────────
async function reconConhecidos() {
  linha('3) CONTROLE — editais que o acervo já tem gravados');
  for (const u of [`${B}/editais/EA00180326CPVERE.PDF`, `${B}/editais/EL00350226CPARE.PDF`]) {
    const r = await get(u, { Referer: `${B}/sistema/detalhe-imovel.asp` });
    const ehPdf = r.status === 200 && (/pdf/i.test(r.ct) || r.buffer.slice(0, 5).toString() === '%PDF-');
    console.log(`  ${ehPdf ? '✓' : '✗'} ${u} → HTTP ${r.status} ${r.ct} ${r.buffer.length}B ${ehPdf ? `(${(r.buffer.length / 1024).toFixed(0)} KB)` : ''}`);
  }
}

await reconCliente();
const num = await reconPagina();
await reconUrlMontada(num);
await reconConhecidos();
console.log('\n✅ Recon concluído.');
