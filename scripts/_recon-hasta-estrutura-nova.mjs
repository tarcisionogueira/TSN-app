// RECON DESCARTÁVEL (19/09) — 3ª mudança de estrutura do HASTA. O diagnóstico anterior
// (_teste-hasta-via-proxy.mjs, PR #369/#370) já provou que NÃO é bloqueio (200 real nos 9
// eventos) nem esvaziamento (lote conhecido 10739 ainda abre) — só que os padrões que o
// parser de produção procura (href /item/<id>/detalhes na listagem; rótulos "Cidade:",
// "Valor de Avaliação:" etc. no detalhe) não batem mais. Este script dumpa HTML BRUTO (não
// texto stripado) para achar os padrões novos: âncoras reais de lote na listagem de um
// evento, e um recorte em volta de onde cidade/valor deveriam estar no detalhe.
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';
import { extrairUrlsDeEvento, TENANTS } from './lib/hasta-parse.mjs';

if (!proxyIspDisponivel()) { console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes.'); process.exit(1); }

const BASE = TENANTS.hasta.base;
const motor = criarMotorDom({ esperaMs: 4000, timeoutMs: 45000, usarProxyIsp: true });

function achar(html, re, n = 6) {
  return [...String(html || '').matchAll(re)].slice(0, n).map(m => m[0]);
}

console.log(`\n=== ${BASE}/leiloes ===`);
const { html: htmlLista } = await motor.fetchFonte(`${BASE}/leiloes`);
if (!htmlLista) { console.log('❌ listagem de eventos não abriu.'); await motor.fechar(); process.exit(0); }
const eventos = extrairUrlsDeEvento(htmlLista, BASE);
console.log(`Eventos: ${eventos.size} → ${[...eventos.keys()].slice(0, 3).join(', ')}...`);

const [id1, url1] = [...eventos.entries()][0];
console.log(`\n=== leilão ${id1}: ${url1} ===`);
const { html: htmlEv } = await motor.fetchFonte(url1);
if (!htmlEv) { console.log('❌ evento não abriu.'); await motor.fechar(); process.exit(0); }
console.log(`bytes: ${htmlEv.length}`);

// TODOS os hrefs distintos (prefixo de path) para achar o padrão novo de link de lote.
const hrefs = [...htmlEv.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
const prefixos = new Map();
for (const h of hrefs) {
  const p = h.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].replace(/\d+/g, '<N>');
  prefixos.set(p, (prefixos.get(p) || 0) + 1);
}
console.log('Prefixos de href mais comuns:');
for (const [p, n] of [...prefixos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}x  ${p}`);

// Amostra de hrefs que contêm dígitos (candidatos a lote/item/produto).
console.log('\nHrefs com dígito (até 15):');
for (const h of hrefs.filter(h => /\d/.test(h)).slice(0, 15)) console.log(`  ${h}`);

// Lote CONHECIDO já no acervo.
const LOTE = process.env.HASTA_LOTE_TESTE || '10739';
const urlLote = `${BASE}/item/${LOTE}/detalhes`;
console.log(`\n=== lote conhecido ${LOTE}: ${urlLote} ===`);
const { html: htmlDet } = await motor.fetchFonte(urlLote);
if (!htmlDet) { console.log('❌ detalhe não abriu.'); await motor.fechar(); process.exit(0); }
console.log(`bytes: ${htmlDet.length}`);

// Onde foram parar os rótulos que o parser antigo procurava?
for (const rotulo of ['Cidade', 'Endere', 'Matr', 'Avalia', 'Leilão', 'Descri']) {
  const re = new RegExp(`.{0,30}${rotulo}.{0,80}`, 'gi');
  const achados = achar(htmlDet, re, 3);
  console.log(`\nOcorrências de "${rotulo}" (até 3, com contexto bruto):`);
  achados.forEach(a => console.log(`  ...${a.replace(/\s+/g, ' ')}...`));
}

// Texto visível (stripado) das primeiras 2000 chars pra visão geral.
const texto = htmlDet.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
console.log(`\nTexto visível (2000 chars):\n${texto.slice(0, 2000)}`);

await motor.fechar();
console.log('\n✅ recon concluído.');
