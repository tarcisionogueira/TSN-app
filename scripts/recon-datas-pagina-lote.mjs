/**
 * RECON (só lê) — de onde o extrator genérico de datas tira a "2ª praça" de um lote. 23/09.
 * Lote ZUK Alameda dos Lírios 196: a página diz "Encerra em 29/09 às 11h40" e o banco gravou
 * data_leilao_2 = 05/10 14h03 (BRT) — data que não consta no lote nem no edital. Hipótese: a
 * página lista OUTROS imóveis (similares/relação do leilão) com as datas deles. Baixa a página
 * como o enriquecimento baixa (HTML, sem render), roda o MESMO extrairDatasLeilao e imprime cada
 * data com o contexto e a POSIÇÃO no texto (% da página), mais os títulos de seção, para achar
 * o marcador onde cortar. Env: URLS (vírgula).
 */
import { extrairDatasLeilao } from '../api/enriquecer-lote.js';

const URLS = (process.env.URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RE = /(\d{2})\/(\d{2})\/(\d{2,4})(?:[^0-9]{0,12}(\d{1,2})[:h](\d{2}))?/g;

for (const url of URLS) {
  console.log(`\n${'═'.repeat(90)}\n${url}`);
  let html = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(30000) });
    html = await r.text();
    console.log(`HTTP ${r.status} · ${html.length} bytes`);
  } catch (e) { console.log(`falhou: ${e.message}`); continue; }
  console.log('extrairDatasLeilao →', JSON.stringify(extrairDatasLeilao(html)));
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  for (const m of html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const t = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) console.log(`  [título ${Math.round(100 * m.index / html.length)}%] ${t.slice(0, 90)}`);
  }
  for (const m of txt.matchAll(RE)) {
    console.log(`  [data ${String(Math.round(100 * m.index / txt.length)).padStart(3)}%] ${m[0]}  ← …${txt.slice(Math.max(0, m.index - 110), m.index).trim()}`);
  }
}
