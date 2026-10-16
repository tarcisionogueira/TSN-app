// Edital de VÁRIOS lotes sem o bloco do nosso lote isolado não pode doar matrícula/área (28/09:
// 27 lotes com a mesma área de matrícula em cidades diferentes — fato de outro lote colado no nosso).
import { ehDocMultiLote, isolarBlocoDoLote } from '../../api/_edital-extrato.js';
import { extrairMatriculaTexto } from '../../api/_doc-extracao.js';
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
// 05/10 (#50) — trechos REAIS do diagnóstico em produção (TRT-15 via 3TORRES e edital da Caixa).
const trt = 'seguindo-se os descritivos dos lotes e/ou itens que o compõem, a saber:\n1: 0180100-24.1994.5.15.0096 - EXE3 - Jundiaí\n1.1 Tipo do Bem: Imóvel\nIdentificação: Matrícula: 65573 - 1º Cartório\n2: 0010234-11.2019.5.15.0002 - EXE1 - Jundiaí\n2.1 Tipo do Bem: Imóvel';
eq('TRT: itens "N: processo" são multi-lote', ehDocMultiLote(trt), true);
eq('TRT: um item só não é', ehDocMultiLote('1: 0180100-24.1994.5.15.0096 - EXE3 - Jundiaí\n1.1 Tipo do Bem: Imóvel'), false);
eq('3 matrículas distintas = vários imóveis', ehDocMultiLote('Imóvel A, Matrícula: 99543. Imóvel B, matrícula nº 10.359. Imóvel C, MATRÍCULA 7513.'), true);
eq('matrícula + origem (2) não é', ehDocMultiLote('Imóvel objeto da matrícula nº 12.345, aberta a partir da matrícula 6.789.'), false);
// 5ª forma (16/10, SUBLIME 5ª Vara de Franca): bens por LETRA, 2 matrículas, endereço com "lote 04 da quadra".
const franca = `IMÓVEIS:
(A) – 01 (UM) PRÉDIO RESIDENCIAL, à RUA RAUL MONTES TORRES nº 920, terreno composto do lote 04 da quadra 17,
confrontando com parte do lote 06, encerrando a área de 250,00 m2. MATRÍCULA Nº 15.839 DO 2º CARTÓRIO.
AVALIAÇÃO ATUALIZADA: R$ 635.514,71 em outubro/2026.
(B) – 01 (UMA) GLEBA DE TERRAS, Ribeirão Corrente-SP, com a área de 10,55,00 ha, por 253,00 m.
MATRÍCULA Nº 17.677 DO 2º CARTÓRIO. AVALIAÇÃO ATUALIZADA: R$ 3.014.535,96 em outubro/2026.`;
eq('bens (A)/(B) com 2 matrículas = multi', ehDocMultiLote(franca), true);
eq('a casa fica com a matrícula DELA', extrairMatriculaTexto(isolarBlocoDoLote(franca, { valorAvaliacao: 635514.71 }) || '')?.numeroMatricula, '15839');
eq('a gleba fica com a DELA', extrairMatriculaTexto(isolarBlocoDoLote(franca, { valorAvaliacao: 3014535.96 }) || '')?.numeroMatricula, '17677');
eq('a gleba não herda os 250 m² da casa', extrairMatriculaTexto(isolarBlocoDoLote(franca, { valorAvaliacao: 3014535.96 }) || '')?.areaTerrenoM2 ?? null, null);
eq('lote principal (A+B) não casa com bloco nenhum', isolarBlocoDoLote(franca, { valorAvaliacao: 3650050.67 }), null);
eq('"a) à vista; b) parcelado" com 1 matrícula não é multi', ehDocMultiLote('Matrícula nº 12.345.\na) – pagamento à vista;\nb) – parcelado em 30 vezes.'), false);
console.log(`${falhas ? '✗' : '✓'} edital-de-varios-lotes: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
