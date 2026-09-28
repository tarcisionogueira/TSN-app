// Edital de VÁRIOS lotes sem o bloco do nosso lote isolado não pode doar matrícula/área (28/09:
// 27 lotes com a mesma área de matrícula em cidades diferentes — fato de outro lote colado no nosso).
import { ehDocMultiLote } from '../../api/_edital-extrato.js';
let ok = 0, falhas = 0;
const eq = (n, a, b) => { const p = a === b; p ? ok++ : falhas++; if (!p) console.log('✗', n, a, '≠', b); };
eq('enumeração de lotes é multi-lote', ehDocMultiLote('EDITAL. Lote 01 - Casa em Jaú, matrícula 1.234.\nLote 02 - Terreno em Bauru, matrícula 5.678.'), true);
eq('"Lote n° 3:" + "Lote n° 4:"', ehDocMultiLote('Lote nº 3: apartamento.  Lote nº 4: sala comercial.'), true);
eq('confrontação com lote vizinho não é multi-lote', ehDocMultiLote('Terreno constituído do lote 29, que confronta com o lote 30, e de outro lado com o lote 28.'), false);
eq('lote único enumerado', ehDocMultiLote('Lote 01 - Casa com 120 m², matrícula 9.999.'), false);
eq('texto vazio', ehDocMultiLote(''), false);
console.log(`${falhas ? '✗' : '✓'} edital-de-varios-lotes: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
