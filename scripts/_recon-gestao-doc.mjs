// TEMPORÁRIO — recon pontual: será removido depois de confirmar/corrigir o achado.
// Pergunta: a página do LOTE (url_lote) do cluster Gestão de Leilões tem mesmo um link de
// documento (edital/matrícula/laudo/.pdf) que extrairDocsDoHtml() (scraper-gestao.mjs)
// deveria estar achando? Produção grava anexos=null pra 100% dos lotes desde 09/09 (o dia
// em que o scan de <a href> foi implementado) — precisa saber se é o HTML que não tem o
// link, ou se é o código que erra o link que existe.
import './lib/env-runner.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';
import { decodificarEntidades } from '../api/_texto-imovel.js';

const url = process.argv[2] || 'https://lancenoleilao.com.br/lote.php?idLote=27293';

function extrairDocsDoHtml(html, urlBase) {
  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, urlBase); } catch { continue; }
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      docs.push({ url: abs.href, label: label.slice(0, 80) });
    }
  }
  return docs;
}

async function main() {
  console.log(`Buscando ${url} via Bright Data...`);
  let r;
  try {
    r = await buscarViaBrightData(url, { proposito: 'gestao', timeoutMs: 60000, exigirOk: false });
  } catch (e) {
    console.error('ErroBrightData:', e instanceof ErroBrightData ? e.message : e);
    process.exit(1);
  }
  if (!r || !r.ok) { console.error('resposta não ok:', r?.status); process.exit(1); }
  const buf = await r.arrayBuffer();
  const html = new TextDecoder('windows-1252').decode(buf);
  console.log(`HTML: ${html.length} bytes`);

  const docs = extrairDocsDoHtml(html, url);
  console.log(`\nextrairDocsDoHtml() encontrou: ${docs.length}`);
  console.log(JSON.stringify(docs, null, 2));

  // Rede de segurança: se o regex não achou nada, procura à mão por qualquer <a href> que
  // pareça um arquivo OU qualquer menção a documento/anexo/download no HTML — pra saber se o
  // link existe com outro rótulo/formato, ou se simplesmente não tem link nenhum na página.
  console.log('\n--- Todos os <a href> da página (até 40) ---');
  let n = 0;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (n >= 40) break;
    const href = m[1];
    const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    console.log(`  href="${href}"  label="${label.slice(0, 60)}"`);
    n++;
  }
  console.log(`\n--- Menções a "document"/"anexo"/"download"/"pdf" no HTML cru (case-insensitive), até 15 ---`);
  const re = /.{0,60}(document|anexo|download|\.pdf|arquivo).{0,60}/gis;
  let n2 = 0;
  for (const m of html.matchAll(re)) {
    if (n2 >= 15) break;
    console.log(`  …${m[0].replace(/\s+/g, ' ').trim()}…`);
    n2++;
  }

  console.log('\n--- URLs completas de fancybox.open (navEdital/navAnexo), sem truncar ---');
  for (const m of html.matchAll(/\$\("#(navEdital|navAnexo)"\)\.click\(function\(\)\{\$\.fancybox\.open\(\{href\s*:\s*'([^']+)'/gi)) {
    console.log(`  ${m[1]} -> ${m[2]}`);
  }
  console.log('\n--- Qualquer .php?...Anexos... na página ---');
  for (const m of html.matchAll(/[a-zA-Z0-9_/.-]*[Aa]nexos\.php\?[^'")\s]*/g)) {
    console.log(`  ${m[0]}`);
  }

  // URL secundária opcional (ex.: o endpoint AJAX de anexos achado na 1ª rodada) — busca e
  // dumpa os <a href> dela também, pra confirmar se É ali que mora o PDF de verdade.
  const url2 = process.argv[3];
  if (url2) {
    console.log(`\n\n=== 2ª URL: ${url2} ===`);
    let r2;
    try { r2 = await buscarViaBrightData(url2, { proposito: 'gestao', timeoutMs: 60000, exigirOk: false }); }
    catch (e) { console.error('ErroBrightData (2ª url):', e instanceof ErroBrightData ? e.message : e); return; }
    if (!r2 || !r2.ok) { console.error('2ª url não ok:', r2?.status); return; }
    const buf2 = await r2.arrayBuffer();
    const html2 = new TextDecoder('windows-1252').decode(buf2);
    console.log(`HTML: ${html2.length} bytes`);
    console.log('Docs achados:', JSON.stringify(extrairDocsDoHtml(html2, url2), null, 2));
    console.log('--- <a href> (até 30) ---');
    let n3 = 0;
    for (const m of html2.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (n3 >= 30) break;
      const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      console.log(`  href="${m[1]}"  label="${label.slice(0, 60)}"`);
      n3++;
    }
    if (html2.length <= 20000) {
      console.log('--- HTML completo (≤20kb) ---');
      console.log(html2);
    } else {
      console.log('--- amostra crua (primeiros 1500 chars) ---');
      console.log(html2.slice(0, 1500));
    }
  }
}
main();
