// Lote sem cidade e sem UF não pode ganhar coordenada (03/10): `coordValida` não tem contra o
// que conferir e aceitava qualquer ponto — "Apartamento Residencial Moema" virou pino no Pará
// com geocod_nivel='rua'. O retorno antecipado não faz NENHUMA chamada de rede: se fizesse,
// o fetch abaixo denunciaria.
import assert from 'node:assert/strict';
import { geocodificarCascata } from '../../api/_geo.js';

let chamadas = 0;
globalThis.fetch = async () => { chamadas++; throw new Error('não deveria chamar a rede'); };

const semNada = { titulo: 'Apartamento Residencial Moema 1 Dormitorios', cidade: null, estado: null, endereco: '', bairro: null };
assert.equal(await geocodificarCascata(semNada, { sleepMs: 0 }), null);
assert.equal(await geocodificarCascata({ ...semNada, cidade: '', estado: '' }, { sleepMs: 0 }), null);
assert.equal(await geocodificarCascata({ ...semNada, estado: 'XX' }, { sleepMs: 0 }), null); // UF inválida não conta
assert.equal(chamadas, 0);
console.log('✓ geocod-sem-cidade-nao-chuta: 3 casos, 0 chamadas de rede');
