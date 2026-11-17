import assert from 'node:assert/strict';
import { RE_ENCERRAMENTO, pareceImovelSemCategoria } from '../lib/gestao-datas.mjs';
// Texto REAL da página do evento 506 da Vinco (lido pelo banco em 17/11) e o formato do cluster.
assert.equal('Data: Abertura: 10/Nov/2026, a partir de 16h00 Encerramento: 11/Dez/2026, a partir de 16h00'.match(RE_ENCERRAMENTO)?.[1], '11/Dez/2026');
assert.equal('Data: Abertura 14/Out/2026, 10h00 Encerramento 04/Nov/2026'.match(RE_ENCERRAMENTO)?.[1], '04/Nov/2026');
assert.equal('Data: 22/Out/2026, a partir de 16h00'.match(RE_ENCERRAMENTO), null);
// Card sem categoria (Vinco 500, texto real): imóvel pelo título; veículo/móvel continua fora.
assert.equal(pareceImovelSemCategoria('001 Maior Lance 0,00 Usuário - RESIDêNCIA COM 3 SUíTES, PISCINA E VISTA PANORâMICA', 'Leilão Particular -Mansão no Cond. Reserva Santa Anna'), true);
assert.equal(pareceImovelSemCategoria('001 Mesa de Jantar com 8 lugares', 'Leilão Particular- Mesa de Jantar - São Paulo/SP'), false);
assert.equal(pareceImovelSemCategoria('001 Motocicleta Honda Lead 110', 'Leilão Judicial - Motocicleta'), false);
console.log('✅ gestao-encerramento: com e sem dois-pontos; card sem categoria — ok');
