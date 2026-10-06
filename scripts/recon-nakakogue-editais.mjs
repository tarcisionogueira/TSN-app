/**
 * RECON — EDITAIS DOS LOTES NAKAKOGUE SEM CIDADE (06/10) — SÓ LEITURA, grava em recon_dump.
 *   node scripts/recon-nakakogue-editais.mjs
 *
 * Os 4 lotes (leilões 137576, 137569 ×2, 137547) não traziam link de edital no catálogo e a página
 * do lote é só casca. Aqui: procura no catálogo, na home e em páginas candidatas do leilão qualquer
 * PDF ligado a esses leilões; lê cada PDF e guarda os trechos com a cidade do imóvel (CRI/comarca/
 * matrícula/"situado"), e o trecho do edital que descreve cada lote (pelas palavras do título).
 */
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
const BASE = 'https://www.nakakogueleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const LOTES = [
  { fonte_id: 'nakakogueleiloes_137576_3001', leilao: '137576', chave: ['Clevel', 'Geminada'] },
  { fonte_id: 'nakakogueleiloes_137569_3601', leilao: '137569', chave: ['Urano', 'Pinheirin', 'Quadra'] },
  { fonte_id: 'nakakogueleiloes_137569_3602', leilao: '137569', chave: ['1.705', '53,15'] },
  { fonte_id: 'nakakogueleiloes_137547_101', leilao: '137547', chave: ['41.140', 'gua da on'] },
];
const PDFParse = await carregarPDFParse();

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { status: 0, erro: String(e?.message || e).slice(0, 80) }; }
}
const textoHtml = (b) => b.toString('latin1').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const pdfsDe = (html, base) => {
  const s = new Set();
  for (const m of html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) { try { s.add(new URL(m[1], base).href); } catch { /* href inválido */ } }
  return [...s];
};
async function textoPdf(url) {
  const r = await get(url);
  if (!r.buf || r.buf.subarray(0, 5).toString() !== '%PDF-') return { erro: r.erro || `HTTP ${r.status} / não é PDF` };
  const p = new PDFParse({ data: r.buf });
  try { return { t: String((await p.getText())?.text || '').replace(/\s+/g, ' ') }; }
  catch (e) { return { erro: String(e?.message || e).slice(0, 80) }; }
  finally { await p.destroy().catch(() => {}); }
}
const janela = (t, i, a = 200, d = 400) => t.slice(Math.max(0, i - a), i + d);

const saida = { paginas: [], pdfs: {}, lotes: [] };
const candidatas = [`${BASE}/lotes/consulta/1`, `${BASE}/`, `${BASE}/editais`];
for (const l of new Set(LOTES.map((x) => x.leilao))) candidatas.push(`${BASE}/leilao/${l}`, `${BASE}/detalhe-leilao/${l}`, `${BASE}/lotes/leilao/${l}`);
const todosPdfs = new Set();
const blocos = {};
for (const u of candidatas) {
  const r = await get(u);
  const html = r.buf ? r.buf.toString('latin1') : '';
  const pdfs = pdfsDe(html, u).filter((p) => LOTES.some((l) => p.includes(l.leilao)) || /edital/i.test(p));
  pdfs.forEach((p) => todosPdfs.add(p));
  saida.paginas.push({ url: u, status: r.status, bytes: r.buf?.length || 0, pdfs });
  // trecho do HTML ao redor de cada lote (o catálogo traz os blocos)
  for (const l of LOTES) {
    const i = html.indexOf(`/${l.leilao}/${l.fonte_id.split('_').pop()}`);
    if (i >= 0 && !blocos[l.fonte_id]) blocos[l.fonte_id] = textoHtml(Buffer.from(html.slice(Math.max(0, i - 1500), i + 2500), 'latin1')).slice(0, 1500);
  }
}
const textos = {};
for (const p of [...todosPdfs].slice(0, 12)) {
  const r = await textoPdf(p);
  textos[p] = r.t || '';
  saida.pdfs[p] = r.erro ? { erro: r.erro } : { chars: r.t.length };
}
for (const l of LOTES) {
  const item = { fonte_id: l.fonte_id, bloco_catalogo: blocos[l.fonte_id] || null, achados: [] };
  for (const [p, t] of Object.entries(textos)) {
    if (!t || !p.includes(l.leilao)) continue;
    for (const k of l.chave) {
      const i = t.indexOf(k);
      if (i >= 0) { item.achados.push({ pdf: p, chave: k, trecho: janela(t, i) }); break; }
    }
    const cri = [...t.matchAll(/(CRI|Registro de Im[óo]veis|Comarca|cidade de)[^.]{0,120}/gi)].slice(0, 8).map((m) => m[0]);
    item.achados.push({ pdf: p, cri_comarca: cri });
  }
  saida.lotes.push(item);
  console.log(JSON.stringify(item).slice(0, 2000));
}
const w = await fetch(`${SB}/rest/v1/recon_dump`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ origem: 'recon_nakakogue_editais', chave: new Date().toISOString(), conteudo: saida }) });
console.log(w.ok ? '✅ gravado em recon_dump (recon_nakakogue_editais)' : `⚠️ recon_dump HTTP ${w.status}`);
