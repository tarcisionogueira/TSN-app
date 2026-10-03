// Edital de VÁRIOS lotes sem o bloco do nosso lote isolado não pode doar matrícula/área (28/09:
// 27 lotes com a mesma área de matrícula em cidades diferentes — fato de outro lote colado no nosso).
import { ehDocMultiLote } from '../../api/_edital-extrato.js';
let ok = 0, falhas = 0;
const eq = (n, a, b) => { const p = a === b; p ? ok++ : falhas++; if (!p) console.log('✗', n, a, '≠', b); };
eq('enumeração de lotes é multi-lote', ehDocMultiLote('EDITAL. Lote 01 - Casa em Jaú, matrícula 1.234.\nLote 02 - Terreno em Bauru, matrícula 5.678.'), true);
eq('"Lote n° 3:" + "Lote n° 4:"', ehDocMultiLote('Lote nº 3: apartamento.  Lote nº 4: sala comercial.'), true);
eq('confrontação com lote vizinho não é multi-lote', ehDocMultiLote('Terreno constituído do lote 29, que confronta com o lote 30, e de outro lado com o lote 28.'), false);
eq('lote único enumerado', ehDocMultiLote('Lote 01 - Casa com 120 m², matrícula 9.999.'), false);
// 03/10 — ZUK 37728 (texto real do anexo): "LOTE 001" sozinho na linha, sem pontuação.
const zuk = 'DESCRIÇÃO DOS IMÓVEIS\nCARTEIRA:\nLOTE 001\nMATRÍCULA 7513 do 1° RI local.\nCIDADE / UF Jaboatão\n-- 38 of 41 --\n\nLOTE 002\nMATRÍCULA 10359 do 1° RI local.\n\n1\nLOTE 004\nMATRÍCULA 36934 do 6° RI local.\nENDEREÇO Rua João Sales, 1665, Lote 23 Quadra 02, Planalto Ayrton Senna ,\nFortaleza';
eq('"LOTE 001" sozinho na linha (ZUK)', ehDocMultiLote(zuk), true);
eq('endereço "Lote 23 Quadra 02" em linhas não é enumeração', ehDocMultiLote('ENDEREÇO Rua X, 10\nLote 23 Quadra 02\nLote 24 Quadra 02, Fortaleza'), false);
eq('"LOTE 001" e "Lote 1" são o mesmo lote', ehDocMultiLote('LOTE 001\nCasa em Itu.\nLote 1 - Casa em Itu'), false);
eq('texto vazio', ehDocMultiLote(''), false);
console.log(`${falhas ? '✗' : '✓'} edital-de-varios-lotes: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
