// RECON DESCARTÁVEL (19/09) — 3ª mudança de estrutura do HASTA, RODADA 2. A rodada 1 já
// provou que a listagem /leilao/<id>/lotes (18KB) NÃO tem nenhum href com dígito que pareça
// lote — zero candidatos. O detalhe (/item/<id>/detalhes) tem sidebar "LOTE 001...014" em
// TEXTO VISÍVEL, mas sem href correspondente na varredura anterior — precisa ver o HTML CRU
// ao redor pra saber se é onclick/data-attr/JS. Esta rodada dumpa o HTML INTEIRO da listagem
// (cabe em 18KB) e o trecho cru ao redor do menu de lotes no detalhe.
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';
import { extrairUrlsDeEvento, TENANTS } from './lib/hasta-parse.mjs';

if (!proxyIspDisponivel()) { console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes.'); process.exit(1); }

const BASE = TENANTS.hasta.base;
const motor = criarMotorDom({ esperaMs: 6000, timeoutMs: 45000, usarProxyIsp: true });

console.log(`\n=== ${BASE}/leiloes ===`);
const { html: htmlLista } = await motor.fetchFonte(`${BASE}/leiloes`);
if (!htmlLista) { console.log('❌ listagem de eventos não abriu.'); await motor.fechar(); process.exit(0); }
const eventos = extrairUrlsDeEvento(htmlLista, BASE);
const [id1, url1] = [...eventos.entries()][0];

console.log(`\n=== leilão ${id1}: ${url1} (espera 6s) ===`);
const { html: htmlEv } = await motor.fetchFonte(url1);
if (!htmlEv) { console.log('❌ evento não abriu.'); await motor.fechar(); process.exit(0); }
console.log(`bytes: ${htmlEv.length}`);
console.log('\n----- HTML CRU COMPLETO DA LISTAGEM -----');
console.log(htmlEv);
console.log('----- FIM HTML CRU DA LISTAGEM -----\n');

const LOTE = process.env.HASTA_LOTE_TESTE || '10739';
const urlLote = `${BASE}/item/${LOTE}/detalhes`;
console.log(`\n=== lote conhecido ${LOTE}: ${urlLote} ===`);
const { html: htmlDet } = await motor.fetchFonte(urlLote);
if (!htmlDet) { console.log('❌ detalhe não abriu.'); await motor.fechar(); process.exit(0); }
console.log(`bytes: ${htmlDet.length}`);

// Trecho cru ao redor do menu "LOTE 0xx" (visível no texto, sem href correspondente).
const idxLote = htmlDet.search(/LOTE\s*001/i);
if (idxLote >= 0) {
  console.log('\n----- HTML CRU ao redor de "LOTE 001" (2000 chars antes/depois) -----');
  console.log(htmlDet.slice(Math.max(0, idxLote - 2000), idxLote + 2000));
  console.log('----- FIM -----\n');
} else {
  console.log('\n"LOTE 001" não encontrado no HTML cru (só no texto renderizado?).');
}

// Onde estão os rótulos Cidade/Endereço/Matrícula de VERDADE? Varre o HTML cru inteiro por
// essas palavras (podem estar em outra aba/seção que só carrega sob demanda).
for (const rotulo of ['idade', 'ndere', 'atr[íi]cula', 'CEP', 'UF\\b']) {
  const re = new RegExp(rotulo, 'gi');
  const n = (htmlDet.match(re) || []).length;
  console.log(`Ocorrências brutas de /${rotulo}/i no HTML do detalhe: ${n}`);
}

await motor.fechar();
console.log('\n✅ recon rodada 2 concluído.');
