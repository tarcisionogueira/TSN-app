/**
 * RECON — EDITAL DA CAIXA (venda-imoveis.caixa.gov.br)
 *
 * POR QUÊ: o documental de um apto em Cuiabá/MT (`cef_8555536754309`) saiu "sem acesso ao
 * edital", e a página do lote EXIBE "Baixar edital e anexos" + "Edital: 0027/0326 - CPVE/RE".
 * A captura por navegador (captura-matricula-cef.mjs) rodou nesse lote, gravou matrícula e
 * condições de venda, e NÃO achou o edital — ou seja, o seletor de âncora erra o alvo.
 *
 * Em paralelo, `leiloeiro_conhecimento` afirma "edital 100% sobre leilão (10.221/10.221)"
 * porque contou `link_edital` = PÁGINA de detalhe como se fosse o edital. A IA precisa do
 * PDF; a página HTML não serve. A métrica declarou vitória medindo a coisa errada.
 *
 * HIPÓTESE A TESTAR: a URL do edital é FUNÇÃO do número impresso na página.
 *   "Edital: 0027/0326 - CPVE/RE" + licitação aberta → /editais/EA00270326CPVERE.PDF
 *   "Edital: 0035/0226 - CPA/RE"  + leilão            → /editais/EL00350226CPARE.PDF
 * (os 8 lotes do acervo que têm PDF real seguem exatamente esse formato: EA…CPVERE para
 * licitacao_aberta, EL…CPARE para extrajudicial). Se confirmar, o edital deixa de depender
 * de scraping de âncora: monta-se a URL. E como o edital da Caixa é COLETIVO, poucos PDFs
 * cobrem milhares de lotes.
 *
 * RODA NO GITHUB ACTIONS: o IP do runner (Azure) é atendido pela Caixa; o proxy do ambiente
 * de desenvolvimento é bloqueado para esse host. Só LÊ e imprime — não grava nada.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const B = 'https://venda-imoveis.caixa.gov.br';
const H = { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Referer: `${B}/sistema/busca-imovel.asp` };
const NUM = process.env.RECON_NUM || '8555536754309'; // apto de Cuiabá/MT do relato
const UF = process.env.RECON_UF || 'MT';

const linha = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);

async function pegar(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(25000), ...opts });
    return { ok: r.ok, status: r.status, ct: r.headers.get('content-type') || '', len: Number(r.headers.get('content-length') || 0), r };
  } catch (e) { return { ok: false, status: 0, ct: '', len: 0, erro: String(e.message).slice(0, 120) }; }
}

// ─── 1) A página do lote: onde está o link "Baixar edital e anexos"? ───────────
async function reconPagina() {
  linha(`1) PÁGINA DO LOTE — detalhe-imovel.asp (imóvel ${NUM})`);
  let html = null;
  for (const url of [`${B}/sistema/detalhe-imovel.asp?hdnimovel=${NUM}`, `${B}/sistema/detalhe-imovel.asp?hdniip=${NUM}`]) {
    const res = await pegar(url);
    console.log(`  ${url}\n    → HTTP ${res.status} ${res.ct} ${res.erro || ''}`);
    if (res.ok) { const t = await res.r.text(); if (t && t.length > 500) { html = t; console.log(`    → ${t.length} bytes`); break; } }
  }
  if (!html) { console.log('  ✗ não obtive o HTML da página.'); return null; }

  // O que a página diz sobre o edital: número impresso + QUALQUER menção a /editais/
  const numEdital = html.match(/Edital[:\s]*<\/?[^>]*>?\s*(\d{3,4})\s*\/\s*(\d{3,4})\s*-\s*([A-Z]{2,6}\s*\/\s*[A-Z]{2,4})/i)
                 || html.match(/(\d{4})\s*\/\s*(\d{4})\s*-\s*([A-Z]{2,6}\s*\/\s*[A-Z]{2,4})/);
  console.log(`\n  Número do edital impresso: ${numEdital ? `${numEdital[1]}/${numEdital[2]} - ${numEdital[3]}` : '(não casou)'}`);

  console.log('\n  Todas as ocorrências de "/editais/" no HTML CRU:');
  const vistos = new Set();
  for (const m of html.matchAll(/[^\s"'<>()]*\/editais\/[^\s"'<>()]+/gi)) {
    if (!vistos.has(m[0])) { vistos.add(m[0]); console.log(`    • ${m[0]}`); }
  }
  if (!vistos.size) console.log('    (nenhuma — o link deve ser montado por JS)');

  console.log('\n  Trecho ao redor de "edital" (para ver href/onclick reais):');
  const re = /edital/gi; let m, n = 0;
  while ((m = re.exec(html)) && n < 8) {
    const t = html.slice(Math.max(0, m.index - 260), m.index + 260).replace(/\s+/g, ' ');
    console.log(`    [${++n}] …${t}…`);
    re.lastIndex = m.index + 400;
  }
  return { html, numEdital };
}

// ─── 2) A hipótese: a URL é montável a partir do número do edital ──────────────
async function reconUrlMontada(numEdital) {
  linha('2) HIPÓTESE — URL montada a partir do número do edital');
  if (!numEdital) { console.log('  (sem número impresso; pulando)'); return; }
  const [, nnnn, mmyy, unidRaw] = numEdital;
  const unid = unidRaw.replace(/[^A-Z]/gi, '').toUpperCase();
  const cands = ['EA', 'EL', 'ED'].flatMap(p => [
    `${B}/editais/${p}${nnnn}${mmyy}${unid}.PDF`,
    `${B}/editais/${p}${nnnn}${mmyy}${unid}.pdf`,
  ]);
  for (const u of cands) {
    const res = await pegar(u, { method: 'GET' });
    const ehPdf = res.ok && /pdf/i.test(res.ct);
    console.log(`  ${ehPdf ? '✓' : '·'} ${u}\n      HTTP ${res.status} ${res.ct} ${res.len || ''} ${res.erro || ''}`);
    if (ehPdf) {
      const buf = Buffer.from(await res.r.arrayBuffer());
      console.log(`      → PDF REAL: ${(buf.length / 1024).toFixed(0)} KB, assinatura ${buf.slice(0, 5).toString()}`);
      return u;
    }
  }
  console.log('  ✗ nenhum candidato retornou PDF.');
}

// ─── 3) O CSV: já traz o número/URL do edital e nós não mapeamos? ──────────────
async function reconCsv() {
  linha(`3) CSV oficial (Lista_imoveis_${UF}.csv) — tem coluna de edital?`);
  const res = await pegar(`${B}/listaweb/Lista_imoveis_${UF}.csv`);
  console.log(`  HTTP ${res.status} ${res.ct} ${res.erro || ''}`);
  if (!res.ok) return;
  const txt = Buffer.from(await res.r.arrayBuffer()).toString('latin1');
  const linhas = txt.split(/\r?\n/).filter(l => l.trim());
  console.log(`  ${linhas.length} linhas.`);
  linhas.slice(0, 4).forEach((l, i) => console.log(`    L${i}: ${l.slice(0, 400)}`));
  const alvo = linhas.find(l => l.includes(NUM));
  console.log(`\n  Linha do imóvel ${NUM}: ${alvo ? alvo.slice(0, 500) : '(não encontrada neste UF)'}`);
  console.log(`  Menciona "edital"? ${/edital/i.test(txt.slice(0, 4000)) ? 'SIM no cabeçalho' : 'não no cabeçalho'}`);
}

// ─── 4) Amostra: os editais que JÁ temos ainda respondem? ──────────────────────
async function reconConhecidos() {
  linha('4) CONTROLE — editais que o acervo já tem gravados respondem?');
  for (const u of [`${B}/editais/EA00180326CPVERE.PDF`, `${B}/editais/EL00350226CPARE.PDF`]) {
    const res = await pegar(u);
    console.log(`  ${res.ok && /pdf/i.test(res.ct) ? '✓' : '✗'} ${u} → HTTP ${res.status} ${res.ct} ${res.erro || ''}`);
  }
}

const p = await reconPagina();
await reconUrlMontada(p?.numEdital);
await reconCsv();
await reconConhecidos();
console.log('\n✅ Recon concluído.');
