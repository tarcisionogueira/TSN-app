/**
 * BACKFILL DO EDITAL DA CAIXA — grava a URL REAL do PDF em `link_edital`.
 *
 * POR QUÊ (relato do dono, 04/08): o documental de um apto em Cuiabá/MT saiu "sem acesso ao
 * edital" sendo um leilão da Caixa, que TEM edital publicado. Medido no acervo: dos 27.278
 * lotes CEF ativos, só 8 tinham `link_edital` apontando para um PDF de verdade — 7.187
 * apontavam para a PÁGINA de detalhe (HTML, que a IA não consegue ler como edital) e 2.843
 * para a MATRÍCULA. Na prática: não tínhamos o edital de praticamente nenhum imóvel da Caixa.
 *
 * A CAUSA (recon na página viva, `scripts/recon-cef-edital.mjs`): a Caixa não publica o PDF
 * no href. O link é
 *     <a href='#' onclick=javascript:ExibeDoc('/editais/EA00270326CPVERE.PDF')>
 *        <strong>Baixar edital e anexos</strong></a>
 * — href='#' e o caminho dentro do ONCLICK. Todo seletor que lia `a.href` voltava vazio, e a
 * captura marcava o lote como concluído sem edital, sem erro nenhum. Silencioso.
 *
 * O CSV oficial NÃO ajuda: suas colunas são apenas
 *   n do imovel · uf · cidade · bairro · endereco · preco · valor de avaliacao · desconto
 *   · financiamento · descricao · modalidade de venda · link de acesso
 * (confirmado no log do scraper de 03/08). O edital só existe na página do lote.
 *
 * O QUE ESTE SCRIPT FAZ: para cada lote CEF de LEILÃO sem edital real, abre a página (HTTP
 * simples, sem navegador — é HTML estático) e grava `link_edital` = URL do PDF e
 * `numero_edital` = o número impresso ("0027/0326 - CPVE/RE"). Não baixa o PDF: a URL é
 * pública e o leitor de documentos busca sob demanda, sem custo de Storage.
 *
 * VENDA DIRETA NÃO ENTRA: por natureza não tem edital (usa "Condições de Venda"/regras).
 *
 * Idempotente e resumível: quem ganha PDF real sai do filtro. Roda no GitHub Actions, onde a
 * Caixa atende o IP. Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import https from 'https';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONCURRENCIA = Number(process.env.EDITAL_CONCURRENCIA || 6);
const LIMITE = Number(process.env.EDITAL_LIMITE || 0); // 0 = tudo
const B = 'https://venda-imoveis.caixa.gov.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('env VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY ausente'); process.exit(1); }
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Cliente HTTP igual ao do scraper diário (node:https), que a Caixa atende sem atrito.
function get(url, hops = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9', Referer: `${B}/sistema/busca-imovel.asp` },
      timeout: 25000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), hops + 1).then(resolve);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, texto: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('error', () => resolve({ status: 0, texto: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, texto: '' }); });
  });
}

// O Radware Bot Manager responde 200 com uma interstitial. Tratar como falha, JAMAIS como
// "página sem edital" — senão o backfill marcaria milhares de lotes como "sem edital" por
// causa de um bloqueio temporário.
const ehCaptcha = (t) => /Radware|Bot Manager CAPTCHA|__uzdbm_/i.test(t || '');

// Extrai o PDF do edital. Lê o ONCLICK (onde a Caixa realmente põe o caminho) além do href,
// e exclui os dois PDFs que NÃO são o edital: a matrícula e o "como comprar" (regras-VOL).
const EXCLUI = /\/editais\/matricula\/|regras-?VOL/i;
function editalDaPagina(html) {
  if (!html) return null;
  for (const m of String(html).matchAll(/(?:https?:\/\/[^\s"'<>()]*)?\/editais\/[^\s"'<>()]+\.pdf/gi)) {
    if (EXCLUI.test(m[0])) continue;
    return new URL(m[0], B).toString();
  }
  return null;
}
// "Edital:&nbsp;0027/0326 - CPVE/RE" → guardado para rastreabilidade e para agrupar lotes
// pelo MESMO edital (o edital da Caixa é COLETIVO: um PDF cobre muitos lotes de várias UFs).
function numeroEditalDaPagina(html) {
  const m = String(html || '').match(/Edital[:\s&nbsp;]*(\d{3,4}\s*\/\s*\d{3,4}\s*-\s*[A-Z]{2,6}\s*\/\s*[A-Z]{2,4})/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}

async function proximoLote(qtd, offset) {
  // Só modalidades de LEILÃO — venda direta não tem edital por natureza.
  // Alvo: link_edital que ainda NÃO é o PDF do edital (página de detalhe, matrícula ou nulo).
  const url = `${SUPABASE_URL}/rest/v1/imoveis_leilao`
    + `?select=id,fonte_id,link_edital,modalidade`
    + `&fonte=eq.CEF&ativo=is.true`
    + `&modalidade=in.(extrajudicial,licitacao_aberta)`
    + `&or=(link_edital.is.null,link_edital.not.ilike.*.pdf,link_edital.ilike.*%2Feditais%2Fmatricula%2F*)`
    + `&order=id.asc&limit=${qtd}&offset=${offset}`;
  const r = await fetch(url, { headers: hdr, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`select ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function gravar(id, linkEdital, numeroEdital) {
  const body = { link_edital: linkEdital };
  if (numeroEdital) body.numero_edital = numeroEdital;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`patch ${r.status}`);
}

// → { s: 'ok'|'sem_edital'|'bloqueado'|'erro', url? }
async function processar(im) {
  const num = String(im.fonte_id || '').replace(/^(caixa_|cef_)/, '').replace(/\D/g, '');
  if (!num) return { s: 'erro' };
  const { status, texto } = await get(`${B}/sistema/detalhe-imovel.asp?hdnimovel=${num}`);
  if (ehCaptcha(texto)) return { s: 'bloqueado' };
  if (status !== 200 || texto.length < 2000) return { s: 'erro' };
  const url = editalDaPagina(texto);
  if (!url) return { s: 'sem_edital' };                // lote de leilão que a Caixa ainda não publicou
  try { await gravar(im.id, url, numeroEditalDaPagina(texto)); return { s: 'ok', url }; }
  catch { return { s: 'erro' }; }
}

async function emLotes(itens, n, fn) {
  const res = []; let i = 0;
  const worker = async () => { while (i < itens.length) { const k = i++; res[k] = await fn(itens[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, worker));
  return res;
}

(async () => {
  console.log(`Backfill edital CEF (concorrência ${CONCURRENCIA}${LIMITE ? `, limite ${LIMITE}` : ''})`);
  let ok = 0, sem = 0, bloq = 0, erro = 0, processados = 0, offset = 0;
  const editais = new Set();
  const t0 = Date.now();
  try {
    while (true) {
      const restante = LIMITE ? Math.min(300, LIMITE - processados) : 300;
      if (restante <= 0) break;
      const lote = await proximoLote(restante, offset);
      if (!lote.length) break;
      const r = await emLotes(lote, CONCURRENCIA, processar);
      let corrigidos = 0;
      for (const x of r) {
        if (x?.s === 'ok') { ok++; corrigidos++; if (x.url) editais.add(x.url); }
        else if (x?.s === 'sem_edital') sem++;
        else if (x?.s === 'bloqueado') bloq++;
        else erro++;
      }
      processados += lote.length;
      // PAGINAÇÃO EXATA: quem foi corrigido SAI do filtro, então essas posições somem
      // sozinhas. O offset só avança pelos que PERMANECERAM (sem edital publicado, erro,
      // bloqueio) — senão pularíamos ~1 lote não processado para cada 1 corrigido.
      offset += lote.length - corrigidos;
      console.log(`… ${processados} | ok=${ok} sem_edital=${sem} bloqueado=${bloq} erro=${erro} | ${editais.size} editais distintos | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      // O bloqueio do Radware é temporário e vale para a rodada inteira: insistir só queima
      // tempo e reforça o bloqueio. Para e deixa a próxima execução retomar (idempotente).
      if (bloq > 30 && bloq > ok) { console.error('⚠️ Bloqueio do Bot Manager predominante — interrompendo; a próxima execução retoma.'); break; }
      if (LIMITE && processados >= LIMITE) break;
    }
  } catch (e) {
    console.error(`⚠️ Interrompido (parcial preservado): ${String(e?.message || e).slice(0, 200)}`);
    process.exitCode = 0;
  }
  console.log(`\n✅ ${ok} lotes com edital real, ${sem} sem edital publicado, ${bloq} bloqueados, ${erro} erros.`);
  if (editais.size) {
    // O edital da Caixa é COLETIVO: poucos PDFs cobrem milhares de lotes. Listar ajuda a
    // conferir o padrão (EA… licitação / EL… leilão) e a auditar a cobertura.
    console.log(`   ${editais.size} editais DISTINTOS cobrindo esses lotes:`);
    for (const u of [...editais].sort()) console.log(`     • ${u}`);
  }
})();
