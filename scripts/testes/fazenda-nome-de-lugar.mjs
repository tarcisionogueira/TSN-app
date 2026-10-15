// "Fazenda" é nome de lugar quando o texto nomeia unidade urbana e nada diz de terra rural (15/10:
// "Fazenda Tamboré Residencial 2 - Casa com 710m²" saiu rural e o mercado foi avaliado por hectare).
import assert from 'node:assert/strict';
import { normalizarTipo } from '../../api/_tipo.js';

const casos = [
  ['Santana de Parnaíba/SP - Fazenda Tamboré Residencial 2 - Casa com 710m²', 'casa'],
  ['Apartamento área privativa 42,57m² - Cond. Gralha Azul - Fazenda Rio Grande/PR', 'apartamento'],
  ['Terreno Que Compreende O Lote Nº 9, da Quadra 17, do Loteamento Fazenda São Sebastião', 'terreno'],
  ['Fazenda com casa sede, 50 hectares', 'rural'],
  ['Galpão em fazenda', 'rural'],
  ['Sítio com casa', 'rural'],
  ['Fazenda São Jorge 21,88ha', 'rural'],
  ['Imóvel rural denominado Fazenda Boa Vista', 'rural'],
  ['Fazenda Palmeira', 'rural'],
];
for (const [t, esperado] of casos) assert.equal(normalizarTipo(t), esperado, t);
console.log(`ok ${casos.length} casos`);
