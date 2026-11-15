// FIPEZAP OFICIAL (15/11, arena #484 item 5): baixa a série histórica publicada pela Fipe (grátis, sem cota) e — fora do
// modo seco — grava o preço médio de venda residencial (R$/m²) por cidade em fipezap_cidade. Serve só de ALARME no
// Índice (não entra no valor). Antes, o "FipeZAP" vinha do que a IA declarava na pesquisa: Salvador a R$ 12.434/m² com
// 2 valores, Goiânia "casa" (o índice é de apartamentos). Modo FIPEZAP_SECO=1: só imprime a estrutura, não grava nada.
import { lerXlsx, serialParaData } from './lib/xlsx-leve.mjs';

const URL_FZ = 'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx';
const SECO = process.env.FIPEZAP_SECO === '1';

const r = await fetch(URL_FZ, { signal: AbortSignal.timeout(60000) });
if (!r.ok) { console.error(`[fipezap] download falhou: HTTP ${r.status}`); process.exit(1); }
const buf = new Uint8Array(await r.arrayBuffer());
console.log(`[fipezap] ${buf.length} bytes`);
const { abas } = lerXlsx(buf);
console.log(`[fipezap] ${abas.length} abas: ${abas.map((a) => a.nome).join(' | ')}`);

if (SECO) {
  for (const a of abas.slice(0, 3).concat(abas.filter((x) => /s[ãa]o paulo|salvador/i.test(x.nome)).slice(0, 2))) {
    console.log(`\n=== ${a.nome} (${a.linhas.length} linhas) ===`);
    for (const l of a.linhas.slice(0, 8)) console.log(JSON.stringify(l));
    console.log('...');
    for (const l of a.linhas.slice(-3)) console.log(JSON.stringify(l));
  }
  console.log('\n[fipezap] serial 46266 =', serialParaData(46266));
  process.exit(0);
}
console.error('[fipezap] gravação ainda não implementada — rode com FIPEZAP_SECO=1 (recon da estrutura primeiro).');
process.exit(2);
