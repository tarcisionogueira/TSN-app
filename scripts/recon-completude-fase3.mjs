#!/usr/bin/env node
/**
 * RECON DESCARTÁVEL (20/09) — fase 3. Não grava nada.
 * A) GRUPOLANCE via Puppeteer real (não fetch puro) — a produção visita detalhe via
 *    enriquecerDocumentosLote() com browser real; fetch cru deu 403 na fase 2, mas isso
 *    pode não refletir o caminho de produção.
 * B) Reconfirma o caso biasi_62570 (que a fase 2 pegou com endereço do LEILOEIRO, não do
 *    imóvel) — testa se o marcador "Fotos Mapa Street View" resolve ali também.
 */
import puppeteer from 'puppeteer';
import { decodificarEntidades } from '../api/_texto-imovel.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.json();
}

function textoPlano(html) {
  return decodificarEntidades(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  console.log('\n===== A) GRUPOLANCE via Puppeteer real =====');
  const gl = await sbGet(`imoveis_leilao?select=fonte_id,url_lote&ativo=eq.true&fonte=eq.GRUPOLANCE&order=atualizado_em.desc&limit=3`);
  for (const row of gl) {
    try {
      await page.goto(row.url_lote, { waitUntil: 'networkidle2', timeout: 25000 });
      const html = await page.content();
      const txt = textoPlano(html);
      console.log(`  [GRUPOLANCE] ${row.fonte_id} (${html.length}b)`);
      const mFotosMapa = txt.match(/([^.]{0,80})Fotos Mapa/i);
      console.log(`     antes de "Fotos Mapa": ${mFotosMapa ? `"${mFotosMapa[1]}"` : '(marcador não encontrado)'}`);
      const mLogr = txt.match(/\b(Rua|Av\.?|Avenida|Travessa|Alameda|Rodovia|Estrada)\s+[A-Za-zÀ-ÿ0-9'.\- ]{3,60}/i);
      console.log(`     1º logradouro no texto: ${mLogr ? `"${mLogr[0]}"` : '(nenhum)'}`);
    } catch (e) { console.log(`  [GRUPOLANCE] ${row.fonte_id} → ERRO: ${String(e?.message || e).slice(0, 150)}`); }
  }

  console.log('\n===== B) BIASI — reconfirma biasi_62570 (grabou endereço do leiloeiro na fase 2) =====');
  try {
    await page.goto('https://www.biasileiloes.com.br/sale/detail?id=62570', { waitUntil: 'networkidle2', timeout: 25000 });
    const html = await page.content();
    const txt = textoPlano(html);
    const mFotosMapa = txt.match(/([^.]{0,100})Fotos Mapa Street View/i);
    console.log(`  antes de "Fotos Mapa Street View": ${mFotosMapa ? `"${mFotosMapa[1]}"` : '(marcador não encontrado)'}`);
    // Onde fica o texto do leiloeiro (Av. Fagundes Filho) em relação ao marcador?
    const idxLeiloeiro = txt.indexOf('Fagundes Filho');
    const idxMarcador = txt.indexOf('Fotos Mapa Street View');
    console.log(`  idx "Fagundes Filho" (endereço do leiloeiro) = ${idxLeiloeiro}, idx "Fotos Mapa Street View" = ${idxMarcador}`);
  } catch (e) { console.log(`  ERRO: ${String(e?.message || e).slice(0, 150)}`); }

  await browser.close();
}

main().catch(e => { console.error('[recon-completude-fase3] FALHOU:', e?.message || e); process.exit(1); });
