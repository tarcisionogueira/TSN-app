// "MOTOR CASA" é motorhome, não casa (15/11, HASTA 12301 ativo como tipo casa).
import assert from 'node:assert/strict';
import { naoEhImovel } from '../lib/dom-parse-util.mjs';
const T = 'RENAULT/MARIMAR MCA06.CH (MOTOR CASA) (MOTOR INCOMPLETO) — Salvador/BA';
assert.equal(naoEhImovel(T, T), true, 'motorhome é bem móvel');
assert.equal(naoEhImovel('Motorhome Fiat Ducato 2015', 'Motorhome Fiat Ducato'), true);
assert.equal(naoEhImovel('Casa com 3 quartos em Salvador/BA', 'Casa 3 quartos'), false, 'casa continua imóvel');
assert.equal(naoEhImovel('Casa térrea, garagem para trailer, 200 m²', 'Casa térrea'), false, 'citar trailer não desfaz a casa');
console.log('nao-imovel-motor-casa: ok');
