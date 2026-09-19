// RECON DESCARTÁVEL (19/09) — RODADA 3. Achado da rodada 2: o evento 569 testado está
// "Em Breve" (label no HTML) e a listagem mostra "NENHUM LOTE ENCONTRADO NO MOMENTO" — texto
// HONESTO do próprio site, não bug de parser. O detalhe do lote conhecido 10739 tem um
// <select id="sel-lotes"><option value="ID">LOTE NNN</option>...</select> que navega via JS
// para `/lote/<id>/show?page=1` (achado no <script> da listagem: sel-lotes on('change')).
// Meta tag confirma: author="SOLEON Soluções para Leilões Online" — MESMA plataforma dos
// tenants de scraper-soleon.mjs, cujo extrairUrlsDeLote JÁ tem fallback pra /lote/(\d+)/.
// Esta rodada varre TODOS os 9 eventos: qual está "Em Breve"/vazio de verdade vs qual tem
// lotes de fato (via contagem de <option value="N"> dentro de sel-lotes ou <div class="lote
// ...">), e dumpa a `lista-lotes` de um evento COM lote pra ver o card real.
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';
import { extrairUrlsDeEvento, TENANTS } from './lib/hasta-parse.mjs';

if (!proxyIspDisponivel()) { console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes.'); process.exit(1); }

const BASE = TENANTS.hasta.base;
const motor = criarMotorDom({ esperaMs: 5000, timeoutMs: 45000, usarProxyIsp: true });

console.log(`\n=== ${BASE}/leiloes ===`);
const { html: htmlLista } = await motor.fetchFonte(`${BASE}/leiloes`);
if (!htmlLista) { console.log('❌ listagem de eventos não abriu.'); await motor.fechar(); process.exit(0); }
const eventos = extrairUrlsDeEvento(htmlLista, BASE);
console.log(`Eventos: ${eventos.size}`);

let achouComLote = false;
for (const [id, url] of eventos) {
  const { html } = await motor.fetchFonte(url);
  if (!html) { console.log(`  leilão ${id}: ❌ não abriu`); continue; }
  const emBreve = /em[_\s]?breve/i.test(html.slice(html.indexOf('header-leilao'), html.indexOf('header-leilao') + 3000));
  const vazio = /NENHUM\s+LOTE\s+ENCONTRADO/i.test(html);
  const nOptions = [...html.matchAll(/<option\s+value=["'](\d+)["'][^>]*>\s*LOTE/gi)].length;
  const nDivLote = [...html.matchAll(/class=["'][^"']*\blote-card\b[^"']*["']/gi)].length;
  console.log(`  leilão ${id}: bytes=${html.length} emBreve=${emBreve} vazio=${vazio} options(LOTE)=${nOptions} div.lote-card=${nDivLote}`);
  if (!vazio && nOptions > 0 && !achouComLote) {
    achouComLote = true;
    console.log(`\n  >>> leilão ${id} TEM lote — dumpando div "lista-lotes" bruta <<<`);
    const iStart = html.indexOf('lista-lotes');
    if (iStart >= 0) {
      console.log(html.slice(Math.max(0, iStart - 200), iStart + 4000));
    }
  }
  await new Promise(r => setTimeout(r, 300));
}

if (!achouComLote) console.log('\n⚠️ NENHUM dos 9 eventos tem opção de lote — todos vazios/em breve de verdade.');

await motor.fechar();
console.log('\n✅ recon rodada 3 concluído.');
