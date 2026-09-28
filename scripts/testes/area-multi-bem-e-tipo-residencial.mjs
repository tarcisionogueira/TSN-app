// Lote com vários bens soma as áreas; "Residencial" (nome de loteamento) não faz um lote virar casa.
// Casos reais de 28/09: Embu-Guaçu (LEILAOBRASIL, 2 terrenos) e Araraquara (WEBLEILOES, lote).
import { somaAreasMultiBem, avaliacaoAtualizadaDoTexto } from '../../api/_texto-imovel.js';
import { normalizarTipo } from '../../api/_tipo.js';
let ok = 0, falhas = 0;
const eq = (n, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); p ? ok++ : falhas++; if (!p) console.log('✗', n, JSON.stringify(a), '≠', JSON.stringify(b)); };
const embu = 'Lote 1) Terreno situado à Rua 1, com a área de 1.303,00 m², medindo 8,50 m. Matrícula n° 50.063. R$ Avaliação R$ 11.700,00 (Julho/2005) Lote 2) Terreno situado à Rua 1, com a área de 1.200,00 m², medindo 20,50 m. Avaliação R$ 10.800,00 (julho/2.005). Avalição total R$ 22.500,00 (julho/2005). Avaliação atualizada R$ 66.650,75 (agosto/2025).';
eq('Embu: soma dos 2 terrenos', somaAreasMultiBem(embu), { soma: 2503, partes: [1303, 1200] });
eq('Embu: avaliação atualizada', avaliacaoAtualizadaDoTexto(embu), 66650.75);
eq('"Lote 29 da Quadra 43" não é enumeração', somaAreasMultiBem('Terreno Urbano, Constituído do Lote 29 da Quadra 43, Com A Área Superficial de 320,00m²'), null);
eq('bem sem área: não soma pela metade', somaAreasMultiBem('Lote 1) Casa com 100 m². Lote 2) Vaga de garagem'), null);
eq('Araraquara: lote em "Parque Residencial" é terreno', normalizarTipo('Lote 200,00m² - Parque Residencial Jardim Ipanema, Araraquara/SP'), 'terreno');
eq('"Lote, Residencial, Sagres" é terreno', normalizarTipo('Lote, Residencial, Sagres'), 'terreno');
eq('terreno com residência é casa', normalizarTipo('Terreno urbano possui uma residência em sua área'), 'casa');
eq('lote com área construída é casa', normalizarTipo('Lote nº 01 da quadra A com área de 366,33m² e área construída de 98,74m²'), 'casa');
console.log(`${falhas ? '✗' : '✓'} area-multi-bem-e-tipo: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
