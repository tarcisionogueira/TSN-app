// Alqueire (30/09): tipo explícito converte exato; "alqueire" solto só pela UF de convenção firme.
// Trechos reais do acervo (PR, SP, GO, SC).
import assert from 'node:assert/strict';
import { areaEmAlqueires, extrairAreaM2 } from '../../api/_texto-imovel.js';

assert.equal(areaEmAlqueires('imóvel rural com área total de 10,00 alqueires em Francisco Alves-PR', 'PR'), 242000);
assert.equal(areaEmAlqueires('terras sob n° 267-A, com a área de 5,00 alqueires paulistas; e sitio', 'MG'), 121000, 'tipo escrito vence a UF');
assert.equal(areaEmAlqueires('fazenda 68,30 alqueires com curral e 4 tanques', 'GO'), 3305720);
assert.equal(areaEmAlqueires('É formado por 10 (dez) alqueires, cuja maioria', 'SC'), 0, 'SC sem convenção firme: não chuta');
assert.equal(areaEmAlqueires('É formado por 10 (dez) alqueires, cuja maioria', 'SP'), 242000, 'número por extenso entre parênteses');
assert.equal(areaEmAlqueires('uma parte de terras com área de 01 alqueire mineiro', null), 48400);
assert.equal(areaEmAlqueires('Fazenda Bom Jardim – 2,7.142 alqueires', 'GO'), 0, 'número quebrado não vira área');
assert.equal(areaEmAlqueires('casa na Vila Valqueire', 'RJ'), 0);
assert.equal(areaEmAlqueires('Sítio c/ 15 alqueires - Jacareí/SP', undefined), 0, 'sem UF: não chuta');
// Hectare continua na frente ("9,68,00 ha., ou seja, quatro alqueires").
assert.equal(extrairAreaM2('Sítio c/ 15 alqueires - Jacareí/SP', { uf: 'SP' }), 363000);
// Milhar sem vírgula (30/09): "58.255m²" é 58.255 m², não 58,255.
assert.equal(extrairAreaM2('Chácara c/ 58.255m², contendo casa sede'), 58255);
assert.equal(extrairAreaM2('Gleba - 13.584m² INFORMAÇÕES'), 13584);
assert.equal(extrairAreaM2('área privativa de 49,545 m²'), 49.545, '3 casas decimais não viram 545');
assert.equal(extrairAreaM2('áreas: privativa de 124,8930m²; comum de 49,2263m²'), 124.893);
assert.equal(extrairAreaM2('Casa de 72 m²'), 72);
assert.equal(extrairAreaM2('sala com 45.5 m2'), 45.5);
console.log('area-em-alqueires: todos os casos passaram');
