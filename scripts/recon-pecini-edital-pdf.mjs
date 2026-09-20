#!/usr/bin/env node
/**
 * RECON DESCARTÁVEL (20/09) — a data da praça do PECINI está no PDF do edital, não no HTML do
 * lote? Não grava nada. `link_edital` do PECINI é sempre um PDF (`/preview/<guid>.pdf`); os
 * recons anteriores (fase 1 e fase 2, HTML do lote) só acharam datas de "Consolidação da
 * Propriedade" (evento jurídico passado), nunca "1º Leilão"/"2º Leilão". Testa se o PDF tem.
 */
import { PDFParse } from 'pdf-parse';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.json();
}

async function baixar(url) {
  // Tenta direto primeiro (PDF estático pode não estar atrás do mesmo anti-bot do HTML).
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'application/pdf,*/*' }, signal: AbortSignal.timeout(20000) });
    if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.slice(0, 5).toString('latin1') === '%PDF-') return { buf, via: 'direto' }; }
    console.log(`  direto=${r.status} → tentando Bright Data...`);
  } catch (e) { console.log(`  direto falhou (${String(e?.message || e).slice(0, 60)}) → tentando Bright Data...`); }
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'pecini', timeoutMs: 60000, exigirOk: false });
    if (!bd || !bd.ok) return { buf: null, via: 'bd_bloqueado' };
    const buf = Buffer.from(await bd.arrayBuffer());
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return { buf: null, via: 'bd_nao_pdf' };
    return { buf, via: 'brightdata' };
  } catch (e) {
    return { buf: null, via: e instanceof ErroBrightData ? `bd_erro_${e.motivo}` : 'bd_excecao' };
  }
}

async function main() {
  const rows = await sbGet(`imoveis_leilao?select=fonte_id,link_edital&ativo=eq.true&fonte=eq.PECINI&data_leilao=is.null&limit=4`);
  for (const row of rows) {
    if (!row.link_edital) { console.log(`  [${row.fonte_id}] sem link_edital`); continue; }
    const { buf, via } = await baixar(row.link_edital);
    if (!buf) { console.log(`  [${row.fonte_id}] SEM PDF (${via})`); continue; }
    let texto = '';
    try {
      const parser = new PDFParse({ data: buf });
      const res = await parser.getText();
      texto = res?.text || '';
      await parser.destroy();
    } catch (e) { console.log(`  [${row.fonte_id}] parse falhou: ${String(e?.message || e).slice(0, 100)}`); continue; }
    console.log(`  [${row.fonte_id}] via=${via} pdf=${buf.length}b texto=${texto.length}c`);
    const datas = [...texto.replace(/\s+/g, ' ').matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].slice(0, 15);
    const comContexto = datas.map(m => {
      const antes = texto.replace(/\s+/g, ' ').slice(Math.max(0, m.index - 60), m.index).trim().slice(-55);
      return `"${antes}" → ${m[0]}`;
    });
    console.log(`     datas no PDF: ${comContexto.join(' | ') || '(NENHUMA)'}`);
  }
}

main().catch(e => { console.error('[recon-pecini-edital-pdf] FALHOU:', e?.message || e); process.exit(1); });
