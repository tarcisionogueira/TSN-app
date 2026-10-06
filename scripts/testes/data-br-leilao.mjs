// 06/10, Alphaville: "09/10/2026" (9 de outubro) era lido como 10/09 → "Leilão encerrado em 10/09/2026" a
// 4 dias do pregão, geração recusada e análise na fila da retenção.
import assert from 'node:assert/strict';
import { dataBrParaIso, dataLeilaoIso } from '../../api/_data-br.js';
import { leilaoEncerrado } from '../../src/utils/leilaoEncerrado.js';

assert.equal(dataBrParaIso('09/10/2026'), '2026-10-09');
assert.equal(dataBrParaIso('9/1/2026'), '2026-01-09');
assert.equal(dataBrParaIso('09/10/2026 às 15:00'), '2026-10-09');
assert.equal(dataBrParaIso('2026-10-09'), '2026-10-09', 'ISO passa intacto');
assert.equal(dataBrParaIso('31/13/2026'), null, 'mês inválido não vira data');
assert.equal(dataLeilaoIso('09/10/2026').slice(0, 10), '2026-10-09');
assert.equal(dataLeilaoIso(''), null);

const ano = new Date().getFullYear() + 1;
const futura = `09/10/${ano}`;
const r = leilaoEncerrado({ dataLeilao: futura, modalidade: 'extrajudicial' });
assert.equal(r.encerrado, false, 'data BR futura não está encerrada');
assert.equal(r.ultimaData, `${ano}-10-09`, 'mostra 9 de outubro, não 10 de setembro');
assert.equal(leilaoEncerrado({ dataLeilao: '09/10/2020' }).encerrado, true);
console.log('ok data-br-leilao');
