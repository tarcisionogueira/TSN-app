// Teste DESCARTÁVEL (19/09) — HASTA zerou por 5 dias seguidos (fonte_saude: "respondeu 200 e
// enumerou 0 lote(s)" em TODAS as ~20 execuções desde 15/09, crescendo de 8 para 9 eventos no
// catálogo, sempre 0 lotes). O recon dedicado (recon-hasta-zerou.mjs) só roda na máquina
// residencial do dono — mas agora temos o proxy ISP funcionando do GitHub Actions (confirmado
// 18/09 contra este mesmo site). Reusa o PARSER DE PRODUÇÃO (lib/hasta-parse.mjs) — medir com
// parser próprio mediria o recon, não a produção (forma nº 10 do CLAUDE.md).
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { proxyIspDisponivel } from './lib/motor/proxy-isp.mjs';
import { extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, TENANTS } from './lib/hasta-parse.mjs';

if (!proxyIspDisponivel()) { console.error('BRIGHTDATA_ISP_HOST/USER/PASS ausentes.'); process.exit(1); }

const BASE = TENANTS.hasta.base;
const motor = criarMotorDom({ esperaMs: 4000, timeoutMs: 45000, usarProxyIsp: true });

console.log(`\n=== ${BASE}/leiloes ===`);
const { html: htmlLista, via } = await motor.fetchFonte(`${BASE}/leiloes`);
console.log(`via=${via} · ${htmlLista ? htmlLista.length + ' bytes' : 'null'}`);
if (!htmlLista) { console.log('❌ nem a listagem de eventos abriu.'); await motor.fechar(); process.exit(0); }

const eventos = extrairUrlsDeEvento(htmlLista, BASE);
console.log(`Eventos encontrados: ${eventos.size} → ${[...eventos.keys()].join(', ')}`);

let algumComLote = false;
for (const [id, url] of eventos) {
  console.log(`\n=== leilão ${id}: ${url} ===`);
  const { html, via: viaEv } = await motor.fetchFonte(url);
  if (!html) { console.log(`  via=${viaEv} · null`); continue; }
  const lotes = extrairUrlsDeLote(html, url);
  console.log(`  via=${viaEv} · ${html.length} bytes · lotes encontrados: ${lotes.size}`);
  if (lotes.size) {
    algumComLote = true;
    const [primeiroId, primeiroUrl] = [...lotes.entries()][0];
    console.log(`  1º lote: ${primeiroId} → ${primeiroUrl}`);
  } else {
    // amostra do corpo pra diagnosticar (challenge? "sem lote"? outra coisa?)
    const semTag = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`  amostra do texto (300 chars): ${semTag.slice(0, 300)}`);
  }
}

// Lote CONHECIDO (já no acervo) — separa "listagem não mostra" de "acesso/rota quebrou de vez".
const LOTE_CONHECIDO = process.env.HASTA_LOTE_TESTE || null;
if (LOTE_CONHECIDO) {
  const url = `${BASE}/item/${LOTE_CONHECIDO}/detalhes`;
  console.log(`\n=== lote conhecido ${LOTE_CONHECIDO}: ${url} ===`);
  const { html, via: viaLote } = await motor.fetchFonte(url);
  if (!html) { console.log(`  via=${viaLote} · null`); }
  else {
    const det = parseDetalhe(html, url);
    console.log(`  via=${viaLote} · ${html.length} bytes · parseDetalhe →`, JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }));
  }
}

await motor.fechar();
console.log(`\n✅ concluído. Algum leilão com lote: ${algumComLote}`);
