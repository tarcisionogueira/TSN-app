/**
 * RECON DE UF/CIDADE dos lotes sem estado (06/10, invariante estado_fora_do_padrao) — SÓ LEITURA.
 *   UF_IDS=<uuid,uuid,...> node scripts/recon-uf-lotes.mjs
 *
 * Para cada lote: lê a página do lote, os PDFs linkados nela (até 3) e os documentos já guardados no
 * nosso Storage; passa o texto pelo MESMO inferirUF do coletor (só aceita UF com prova do IBGE) e
 * guarda trechos com "comarca/município/cidade/matrícula" para conferência humana. NÃO grava no
 * acervo: o resultado vai para recon_dump (origem 'recon_uf_lotes') e a decisão é de quem lê.
 */
import { inferirUF } from './lib/inferir-uf.mjs';
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const IDS = String(process.env.UF_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!SB || !KEY || !IDS.length) { console.error('defina VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY e UF_IDS'); process.exit(1); }
const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const PDFParse = await carregarPDFParse();

async function textoPdf(buf) {
  if (!buf || buf.subarray(0, 5).toString() !== '%PDF-') return { erro: 'nao_e_pdf' };
  const p = new PDFParse({ data: buf });
  try {
    const t = String((await p.getText())?.text || '').replace(/\s+/g, ' ');
    return t.replace(/\s/g, '').length < 200 ? { erro: 'pdf sem camada de texto (imagem)' } : { t };
  } catch (e) { return { erro: `pdf ilegível: ${String(e?.message || e).slice(0, 60)}` }; }
  finally { await p.destroy().catch(() => {}); }
}
async function baixar(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { erro: `http_${r.status}` };
    return { buf: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || '' };
  } catch (e) { return { erro: String(e?.message || e).slice(0, 80) }; }
}
const trechos = (t) => {
  const out = [];
  const re = /(comarca|munic[íi]pio|cidade|matr[íi]cula|registro de im[óo]veis|cart[óo]rio|situad[oa]|localizad[oa])/gi;
  for (const m of String(t || '').matchAll(re)) {
    out.push(t.slice(Math.max(0, m.index - 80), m.index + 160));
    if (out.length >= 6) break;
  }
  return out;
};

const resultado = [];
for (const id of IDS) {
  const rl = await fetch(`${SB}/rest/v1/imoveis_leilao?id=eq.${id}&select=fonte_id,titulo,cidade,estado,url_lote,link_edital`, { headers: hdr });
  const [l] = rl.ok ? await rl.json() : [];
  if (!l) { resultado.push({ id, erro: `lote não lido (HTTP ${rl.status})` }); continue; }
  const item = { id, fonte_id: l.fonte_id, fontes: [] };
  const textos = [];
  // 1) Página do lote + PDFs que ela linka
  const pagina = l.url_lote || l.link_edital;
  const pdfs = new Set(/\.pdf(\?|$)/i.test(l.link_edital || '') ? [l.link_edital] : []);
  if (pagina && !/\.pdf(\?|$)/i.test(pagina)) {
    const p = await baixar(pagina);
    if (p.buf) {
      const html = p.buf.toString('utf8');
      for (const m of html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) { try { pdfs.add(new URL(m[1], pagina).href); } catch { /* href inválido: ignora */ } }
      const t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      textos.push(t);
      item.fontes.push({ via: 'pagina', url: pagina, chars: t.length, pdfs_linkados: pdfs.size });
    } else item.fontes.push({ via: 'pagina', url: pagina, erro: p.erro });
  }
  for (const u of [...pdfs].slice(0, 3)) {
    const d = await baixar(u);
    const r = d.buf ? await textoPdf(d.buf) : { erro: d.erro };
    if (r.t) textos.push(r.t);
    item.fontes.push({ via: 'pdf', url: u, chars: r.t?.length || 0, erro: r.erro || null });
  }
  // 2) Documentos já guardados no nosso Storage
  const ra = await fetch(`${SB}/rest/v1/imovel_anexos?imovel_id=eq.${id}&storage_path=not.is.null&select=tipo,storage_path`, { headers: hdr });
  for (const a of (ra.ok ? await ra.json() : []).slice(0, 3)) {
    // o Storage exige a service key
    let buf = null, erro = null;
    try {
      const r = await fetch(`${SB}/storage/v1/object/documentos/${a.storage_path.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30000) });
      if (r.ok) buf = Buffer.from(await r.arrayBuffer()); else erro = `storage http_${r.status}`;
    } catch (e) { erro = String(e?.message || e).slice(0, 80); }
    const t = buf ? await textoPdf(buf) : { erro };
    if (t.t) textos.push(t.t);
    item.fontes.push({ via: 'storage', tipo: a.tipo, chars: t.t?.length || 0, erro: t.erro || null });
  }
  const tudo = textos.join(' \n ');
  item.inferirUF = inferirUF({ titulo: l.titulo, descricao: tudo });
  item.trechos = trechos(tudo);
  console.log(JSON.stringify(item));
  resultado.push(item);
}

const w = await fetch(`${SB}/rest/v1/recon_dump`, { method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' },
  body: JSON.stringify({ origem: 'recon_uf_lotes', chave: new Date().toISOString(), conteudo: resultado }) });
console.log(w.ok ? '✅ gravado em recon_dump (origem recon_uf_lotes)' : `⚠️ recon_dump HTTP ${w.status}`);
