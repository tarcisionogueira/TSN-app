#!/usr/bin/env node
/**
 * Backfill GRÁTIS de CARTÓRIO / OFÍCIO / COMARCA a partir da MATRÍCULA (PDF de
 * texto), no runner do GitHub. Sem IA e sem OCR — só extração de texto do PDF.
 *
 * Alvo: lotes NÃO-CEF (o CEF já recebe comarca/ofício pelo cron da página) com
 * link_matricula em PDF e ainda sem cartório na ficha. Matrículas ESCANEADAS
 * (imagem, sem texto) são marcadas como varridas e ficam para o laudo documental
 * (que lê via IA quando o cliente pede a análise). Custo zero, complementa a
 * tela do imóvel para leilão judicial e extrajudicial.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: MATRICULA_LIMITE, MATRICULA_CONC.
 */
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { extrairRegistroMatricula } from '../api/_registro-matricula.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.MATRICULA_LIMITE || '3000', 10);
const CONC = parseInt(process.env.MATRICULA_CONC || '4', 10);
const DEADLINE = Date.now() + 75 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

// Paginação (Supabase limita ~1000/resposta) até LIMITE candidatos.
async function buscarCandidatos() {
  const PAG = 1000;
  const out = [];
  while (out.length < LIMITE) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('id, fonte, estado, link_matricula, ficha_cef')
      .eq('ativo', true).neq('fonte', 'CEF')
      .is('matricula_scan_em', null)
      .ilike('link_matricula', '%.pdf%')
      .or('ficha_cef.is.null,ficha_cef->>cartorio.is.null')
      .order('id', { ascending: true })
      .range(out.length, out.length + PAG - 1);
    if (error) { console.error('query erro:', error.message); break; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAG) break;
  }
  return out.slice(0, LIMITE);
}

// Baixa o PDF (aborta se demorar/for grande demais/não for PDF).
async function baixarPDF(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' } });
    if (!r.ok) return { erro: `http_${r.status}`, morto: r.status === 404 || r.status === 410 };
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > 12_000_000) return { erro: 'grande', morto: true };
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return { erro: 'nao_pdf', morto: true };
    return { buf };
  } catch (e) {
    return { erro: String(e?.name || e), transiente: true };
  } finally { clearTimeout(t); }
}

async function main() {
  const cands = await buscarCandidatos();
  if (!cands?.length) { console.log('Matrícula: sem candidatos (PDF de texto, não-CEF, sem cartório).'); return; }
  console.log(`Candidatos: ${cands.length} · conc ${CONC} · limite ${LIMITE}`);

  let idx = 0, ok = 0, semTexto = 0, mortos = 0, transientes = 0, feitos = 0, logs = 0;
  const marcar = (id, patch) => supabase.from('imoveis_leilao').update(patch).eq('id', id).then(() => {}, () => {});

  async function worker() {
    while (idx < cands.length && Date.now() < DEADLINE) {
      const im = cands[idx++];
      const dl = await baixarPDF(im.link_matricula);
      if (dl.erro) {
        // Transitório (rede/timeout): deixa p/ a próxima execução (não marca).
        // Morto (404/HTML/gigante): marca para não reprocessar sempre.
        if (dl.transiente) { transientes++; }
        else { mortos++; await marcar(im.id, { matricula_scan_em: new Date().toISOString() }); }
        feitos++; continue;
      }
      let texto = '';
      try {
        const parser = new PDFParse({ data: dl.buf });
        const res = await parser.getText();
        texto = res?.text || '';
        await parser.destroy();
      } catch { texto = ''; }
      const patch = { matricula_scan_em: new Date().toISOString() };
      const reg = texto ? extrairRegistroMatricula(texto) : null;
      if (reg) {
        patch.ficha_cef = { ...(im.ficha_cef && typeof im.ficha_cef === 'object' ? im.ficha_cef : {}), ...reg };
        ok++;
        if (logs < 5) { logs++; console.log(`  [reg ${logs}] ${im.fonte} ${im.estado} → ${JSON.stringify(reg)}`); }
      } else {
        semTexto++; // PDF escaneado (imagem) ou sem cabeçalho legível → fica p/ o laudo (IA).
      }
      await marcar(im.id, patch);
      feitos++;
      if (feitos % 100 === 0) console.log(`  ${feitos}/${cands.length} · com-registro ${ok} · sem-texto ${semTexto} · mortos ${mortos} · transientes ${transientes}`);
      await sleep(150);
    }
  }

  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`FIM: registro preenchido ${ok} · sem-texto/escaneado ${semTexto} · links mortos ${mortos} · transientes(retry) ${transientes} · processados ${feitos}`);
}

main().catch(e => { console.error(e); process.exit(1); });
