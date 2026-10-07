/**
 * ENSAIO EM SECO do coletor novo do WEBLEILOES (#148) — lê o site vivo com o MESMO código da
 * coleta (extrairCardsWebLeiloes + mapaCardWebLeiloes) e imprime o que SERIA gravado. Não grava.
 *
 * Por que existe: o mapeador foi escrito contra dois cards copiados do recon. Dois cards não
 * provam 49 — e as quatro instâncias da forma nº 10 (29/08) só apareceram rodando sobre dado
 * real. Aqui se confere, lote a lote: total × declarado, tipo, modalidade, mínimo ≤ avaliação,
 * datas, cidade/UF e área, antes de o primeiro lote entrar no banco.
 */
import puppeteer from 'puppeteer';
import { extrairCardsWebLeiloes, mapaCardWebLeiloes } from './lib/webleiloes-lote.mjs';

const BASE = 'https://www.webleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const bens = new Map(); let total = 0; let problemas = 0;
try {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  for (let pagina = 1; pagina <= 12; pagina++) {
    const url = pagina === 1 ? `${BASE}/imoveis` : `${BASE}/imoveis?pagina=${pagina}`;
    const antes = bens.size;
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    console.log(`${url}: HTTP ${resp?.status()}`);
    if (!resp || resp.status() >= 400) break;
    await new Promise((r) => setTimeout(r, 2000));
    const { lotes, itens } = await page.evaluate(extrairCardsWebLeiloes);
    if (itens) total = itens;
    for (const l of lotes) {
      const row = mapaCardWebLeiloes(l);
      if (row && !bens.has(row.fonte_id)) bens.set(row.fonte_id, { row, texto: l.texto });
    }
    console.log(`  cards: ${lotes.length} · novos: ${bens.size - antes} · total ${bens.size} de ${total}`);
    if (bens.size === antes || (total && bens.size >= total)) break;
  }
} finally { await browser.close(); }

const rows = [...bens.values()];
const conta = (f) => rows.reduce((m, { row }) => (m[f(row)] = (m[f(row)] || 0) + 1, m), {});
console.log(`\n═══ ${rows.length} lotes mapeados · ${total} declarados pelo site`);
console.log('tipo:', JSON.stringify(conta((r) => r.tipo)));
console.log('modalidade:', JSON.stringify(conta((r) => r.modalidade)));
console.log('estado:', JSON.stringify(conta((r) => r.estado)));
console.log('com data_leilao_2:', rows.filter(({ row }) => row.data_leilao_2).length, '· com área:', rows.filter(({ row }) => row.area_m2 > 0).length, '· com foto:', rows.filter(({ row }) => row.link_foto).length);
for (const { row, texto } of rows) {
  const avisos = [];
  if (!(row.valor_minimo > 0)) avisos.push('SEM VALOR');
  if (row.valor_avaliacao && row.valor_minimo > row.valor_avaliacao) avisos.push('MINIMO>AVALIACAO');
  if (!row.data_leilao && !row.data_leilao_2) avisos.push('SEM DATA');
  if (!row.cidade || !/^[A-Z]{2}$/.test(row.estado)) avisos.push('SEM CIDADE/UF');
  if (!row.titulo || row.titulo.length < 8) avisos.push('TITULO CURTO');
  if (texto.length < 80) avisos.push(`CARD CURTO (${texto.length})`);
  if (avisos.length) problemas++;
  console.log(`${row.fonte_id} | ${row.tipo} | ${row.modalidade} | ${row.cidade}/${row.estado} | ${row.area_m2} m² | min ${row.valor_minimo} | aval ${row.valor_avaliacao} | ${row.data_leilao || '-'} → ${row.data_leilao_2 || '-'} | ${row.titulo}${avisos.length ? '  ⚠️ ' + avisos.join(', ') : ''}`);
  if (avisos.length) console.log(`     card: ${texto.slice(0, 300)}`);
}
console.log(`\n${problemas} lote(s) com aviso.`);
if (!rows.length || (total && rows.length < total * 0.8)) { console.log('⚠️ COLETA ABAIXO DO DECLARADO'); process.exitCode = 1; }
