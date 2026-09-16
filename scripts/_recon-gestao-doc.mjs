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
}
main();
