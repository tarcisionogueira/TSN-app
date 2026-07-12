/**
 * Captura de documentos do FRAZAO — PÚBLICO (sem login). Descoberto via navegador:
 * o link "Consulte o edital e documentação" abre um modal cujo conteúdo vem de
 *   GET https://www.frazaoleiloes.com.br/Sale/LotDocs?loteId={lote}&leilaoId={leilao}
 * → HTML com <ul class="file-list"> de <a href="…pdf" title="…">. Os PDFs ficam em
 *   cdn.frazaoleiloes.com.br/file/loteanexo/{lote}/{n}.pdf  (matrícula do lote)
 *   cdn.frazaoleiloes.com.br/file/leilaoanexo/{leilao}/{n}.pdf (edital/minutas do leilão)
 * Fluxo (fetch, sem navegador): lê a página do lote p/ achar o leilaoId, chama LotDocs,
 * classifica pelos títulos e grava anexos + link_matricula. Config: FZ_LOTE (default 60).
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BASE = 'https://www.frazaoleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const LOTE = Number(process.env.FZ_LOTE || 60);

// Decodifica entidades HTML (&#237; → í, &#186; → º, &amp; → &, …) — os títulos do
// Frazão vêm codificados e quebravam a classificação (ex.: "Matr&#237;cula").
function decodeEnt(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function classifica(txt, url) {
  const t = `${decodeEnt(txt)} ${url || ''}`;
  if (/matr[ií]cul/i.test(t)) return 'matricula';
  if (/laudo|avalia[çc]/i.test(t)) return 'laudo';
  if (/edital/i.test(t)) return 'edital';
  if (/regras|condi[cç][oõ]es|dinâmic|minuta|compromisso|escritura|venda e compra|vale compras/i.test(t)) return 'regras';
  if (/d[eé]bito|iptu|penhora|instrumento|processo|certid|[oô]nus/i.test(t)) return 'anexo';
  // loteanexo = documento ESPECÍFICO do lote; sem rótulo claro (nome tipo timestamp),
  // em lote de imóvel judicial é a MATRÍCULA na esmagadora maioria. leilaoanexo = leilão.
  if (/\/loteanexo\//i.test(url || '')) return 'matricula';
  return 'anexo';
}

function leilaoIdDe(html) {
  return (html.match(/LotDocs\?loteId=\d+&leilaoId=(\d+)/i)      // referência do próprio modal
    || html.match(/leilaoId["'\s:=]+(\d+)/i)
    || html.match(/\/leilao\/(\d+)/i)
    || html.match(/data-leilao-id=["'](\d+)/i) || [])[1] || null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Parseia o HTML do LotDocs → [{url, nome, tipo}]
function parseDocs(html) {
  const out = [];
  const vistos = new Set();
  const reA = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  for (const m of html.match(reA) || []) {
    const href = (m.match(/href=["']([^"']+\.pdf[^"']*)["']/i) || [])[1];
    if (!href) continue;
    const url = href.startsWith('http') ? href : `https:${href.startsWith('//') ? '' : '//'}${href.replace(/^\/+/, 'cdn.frazaoleiloes.com.br/')}`;
    if (vistos.has(url)) continue; vistos.add(url);
    const title = (m.match(/title=["']([^"']+)["']/i) || [])[1];
    const texto = m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const nome = decodeEnt(title || texto || 'Documento').slice(0, 80);
    out.push({ url, nome, tipo: classifica(nome, url) });
  }
  return out;
}

async function main() {
  const { data, error } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital')
    .eq('fonte', 'FRAZAO').eq('ativo', true)
    .or('anexos.is.null,anexos.eq.[]')
    .order('criado_em', { ascending: false }).limit(LOTE);
  if (error) { console.error(error.message); process.exit(1); }
  const lotes = (data || []).map(l => ({ ...l, loteId: (String(l.fonte_id).match(/(\d+)/) || [])[1], page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital })).filter(l => l.loteId && l.page);
  if (!lotes.length) { console.log('FRAZAO: nenhum lote pendente.'); return; }
  console.log(`FRAZAO: ${lotes.length} lote(s) para tentar (cap ${LOTE}).`);

  // Captura os docs de UM lote (com throttle interno). Retorna [] se não achar.
  async function docsDoLote(l) {
    const g = await fetch(l.page, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = await g.text();
    const leilaoId = leilaoIdDe(html);
    const diag = `st=${g.status} len=${html.length} lotdocs=${/LotDocs/i.test(html)} leilaoLink=${/\/leilao\/\d+/i.test(html)}`;
    const urls = [`${BASE}/Sale/LotDocs?loteId=${l.loteId}${leilaoId ? `&leilaoId=${leilaoId}` : ''}`];
    if (leilaoId) urls.push(`${BASE}/Sale/LotDocs?loteId=${l.loteId}`);
    for (const u of urls) {
      await sleep(250);
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: l.page }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const docs = parseDocs(await r.text());
      if (docs.length) return { docs, leilaoId, diag };
    }
    return { docs: [], leilaoId, diag };
  }

  let ok = 0, semDoc = 0, erro = 0, comMat = 0, bloqueios = 0;
  for (const l of lotes) {
    try {
      // O Frazão bloqueia (HTTP 429) após ~27 req por sessão/IP. Uma nova execução
      // (runner novo) ganha nova cota; então paramos cedo ao detectar bloqueio e o
      // schedule/re-dispatch drena o resto aos poucos.
      let { docs, leilaoId, diag } = await docsDoLote(l);
      if (!docs.length && !/st=429/.test(diag || '')) { await sleep(1500); ({ docs, leilaoId, diag } = await docsDoLote(l)); }
      if (!docs.length) {
        semDoc++;
        if (/st=429/.test(diag || '')) { bloqueios++; if (bloqueios >= 5) { console.log(`⛔ bloqueado (429) — parando; rode de novo para drenar o resto.`); break; } }
        console.log(`- ${l.fonte_id}: sem docs (leilaoId=${leilaoId || '?'} ${diag})`);
        await sleep(600); continue;
      }
      bloqueios = 0;
      const ordem = { matricula: 0, edital: 1, laudo: 2, regras: 3, anexo: 4 };
      docs.sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
      const matricula = docs.find(d => d.tipo === 'matricula')?.url || null;
      const upd = { anexos: docs };
      if (matricula) { upd.link_matricula = matricula; comMat++; }
      const { error: e2 } = await supabase.from('imoveis_leilao').update(upd).eq('id', l.id);
      if (e2) { erro++; console.log(`- ${l.fonte_id}: erro gravar ${e2.message}`); continue; }
      ok++; console.log(`✓ ${l.fonte_id}: ${docs.length} doc(s) [${docs.map(d => d.tipo).join(',')}]${matricula ? ' +matrícula' : ''}`);
      await new Promise(s => setTimeout(s, 200));
    } catch (e) { erro++; console.log(`- ${l.fonte_id}: erro ${e.message}`); }
  }
  console.log(`\nFRAZAO — resultado: ${ok} enriquecido(s) · ${comMat} com matrícula · ${semDoc} sem doc · ${erro} erro(s).`);
}
main().catch(e => { console.error(e); process.exit(1); });
