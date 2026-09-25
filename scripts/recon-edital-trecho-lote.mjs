/**
 * RECON (só leitura) — o TRECHO DO LOTE dentro do edital do veículo (25/09, caminho 1 do dono:
 * "ler o trecho de cada lote, sem custo"). O 1º recon (edital-origem-veiculos.mjs) contou palavras
 * no documento INTEIRO e errou pelo texto-padrão. Aqui, por edital: o CABEÇALHO (onde costuma vir
 * "comitente"/"processo"/"vendedor") e, para cada lote nosso, a janela do texto em volta do ponto
 * onde o lote aparece — achado pela placa/chassi quando há, senão pelo modelo + ano do título.
 * Nada é gravado. Serve para escrever a regra por formato de leiloeiro sobre texto real.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; RECON_FONTES (padrão LJUD,SUPORTE,WEBLEILOES,MEGA);
 * RECON_DOCS_POR_FONTE (padrão 4).
 */
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const FONTES = String(process.env.RECON_FONTES || 'LJUD,SUPORTE,WEBLEILOES,MEGA').split(',');
const POR_FONTE = Number(process.env.RECON_DOCS_POR_FONTE || 4);
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}
const PDFParse = await carregarPDFParse();
if (!PDFParse) { console.error('pdf-parse indisponível'); process.exit(1); }

async function texto(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(40000) });
    if (!r.ok) return { erro: `http_${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== '%PDF-') return { erro: 'nao_e_pdf' };
    if (buf.length > 15 * 1024 * 1024) return { erro: 'tamanho' };
    const p = new PDFParse({ data: buf });
    try { return { t: String((await p.getText())?.text || '').replace(/\s+/g, ' ') }; }
    finally { await p.destroy().catch(() => {}); }
  } catch (e) { return { erro: String(e?.message || e).slice(0, 60) }; }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Âncoras do lote, da mais forte para a mais fraca.
function ancoras(v) {
  const out = [];
  if (v.placa) out.push(['placa', String(v.placa).replace(/[^A-Za-z0-9]/g, '')]);
  if (v.chassi) out.push(['chassi', String(v.chassi)]);
  const m = String(v.titulo || '').match(/placa\s*[:\-]?\s*([A-Z]{3}[\s-]?\d[A-Z0-9]\d{2})/i);
  if (m) out.push(['placa_titulo', m[1].replace(/[\s-]/g, '')]);
  const modelo = String(v.modelo || v.titulo || '').replace(/^.*?\//, '').split(/[-–,|]/)[0].trim().split(/\s+/).slice(0, 2).join(' ');
  if (modelo.length >= 3) out.push(['modelo', modelo]);
  return out;
}

for (const fonte of FONTES) {
  const lotes = await sb(`veiculos_leilao?ativo=eq.true&fonte=eq.${fonte}&anexos=not.is.null&select=id,titulo,marca,modelo,placa,chassi,ano_fabricacao,ano_modelo,origem_venda,anexos&limit=400`);
  const porDoc = new Map();
  for (const v of lotes) for (const a of (v.anexos || [])) {
    if (!(a?.tipo === 'edital' || /sl-doc/.test(a?.url || ''))) continue;
    if (!porDoc.has(a.url)) porDoc.set(a.url, []);
    porDoc.get(a.url).push(v);
  }
  const docs = [...porDoc.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, POR_FONTE);
  console.log(`\n################ ${fonte} · ${porDoc.size} editais, amostra ${docs.length}`);
  for (const [url, vs] of docs) {
    const { t, erro } = await texto(url);
    console.log(`\n=== ${fonte} · ${vs.length} lote(s) · ${url.slice(0, 100)}${erro ? ` · ERRO ${erro}` : ` · ${t.length} chars`}`);
    if (!t) continue;
    console.log(`  [CABEÇALHO] ${t.slice(0, 1400)}`);
    const tn = norm(t);
    for (const v of vs.slice(0, 3)) {
      console.log(`  --- lote "${String(v.titulo).slice(0, 80)}" (origem hoje: ${v.origem_venda})`);
      let achou = false;
      for (const [tipo, valor] of ancoras(v)) {
        const i = tn.indexOf(norm(valor));
        if (i < 0) { console.log(`     ${tipo} "${valor}": não achado`); continue; }
        const ocorr = tn.split(norm(valor)).length - 1;
        console.log(`     ${tipo} "${valor}" em ${i} (${ocorr}×): …${t.slice(Math.max(0, i - 700), i + 500)}…`);
        achou = true; break;
      }
      if (!achou) console.log('     nenhuma âncora achada no texto');
    }
  }
}
