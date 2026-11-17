import assert from 'node:assert/strict';
import { RE_ENCERRAMENTO } from '../lib/gestao-datas.mjs';
// Texto REAL da página do evento 506 da Vinco (lido pelo banco em 17/11) e o formato do cluster.
assert.equal('Data: Abertura: 10/Nov/2026, a partir de 16h00 Encerramento: 11/Dez/2026, a partir de 16h00'.match(RE_ENCERRAMENTO)?.[1], '11/Dez/2026');
assert.equal('Data: Abertura 14/Out/2026, 10h00 Encerramento 04/Nov/2026'.match(RE_ENCERRAMENTO)?.[1], '04/Nov/2026');
assert.equal('Data: 22/Out/2026, a partir de 16h00'.match(RE_ENCERRAMENTO), null);
console.log('✅ gestao-encerramento: com e sem dois-pontos — ok');
