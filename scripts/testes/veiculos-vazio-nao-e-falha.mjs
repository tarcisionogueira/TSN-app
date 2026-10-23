// VEÍCULOS (23/10): rodada sem linha gravada só é 'vazio' quando o site respondeu e a recusa é OBJETIVA. Casos reais
// de 22-23/10: SHIOKAWA/ZACCARINO (API inteira, 0 veículos), SAVOY (2.961 de 3.155 só para empresa credenciada).
import assert from 'node:assert/strict';
import { classificarVazio } from '../lib/veiculos-saude.mjs';

const base = { fetchOk: true, rows: [], enumerados: 0, lidos: 0, porRegra: 0, porque: '' };
assert.match(classificarVazio(base), /site sem veículo em aberto/);
assert.match(classificarVazio({ ...base, enumerados: 3155, lidos: 3000, porRegra: 2961, porque: 'só para empresa credenciada: 2961 · sem valor: 24' }), /nenhum arrematável por pessoa física/);
// Catálogo que não abriu, linha gravada, ou recusa que depende da leitura: NÃO é vazio.
assert.equal(classificarVazio({ ...base, fetchOk: false }), null);
assert.equal(classificarVazio({ ...base, enumerados: 5, rows: [{}] }), null);
assert.equal(classificarVazio({ ...base, enumerados: 652, lidos: 652, porRegra: 0, porque: 'não é veículo inteiro: 652' }), null);
assert.equal(classificarVazio({ ...base, enumerados: 100, lidos: 100, porRegra: 80 }), null, 'abaixo de 90% segue falha');
console.log('✓ veículos: vazio legítimo × falha');
