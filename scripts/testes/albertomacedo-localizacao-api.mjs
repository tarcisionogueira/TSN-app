// Localização de item de PACOTE da ALBERTOMACEDO pela API do site (03/10). Dados REAIS do recon
// de 03/10 (pacote "Imóveis em CE, GO, PR e SP"): Moema → city "São Paulo" / state "SP".
import assert from 'node:assert/strict';
import { aplicarLocalizacao } from '../lib/albertomacedo-api.mjs';

const U = (s) => `https://albertomacedoleiloes.com.br/lote/${s}`;
const lotes = [
  { slug: '5-apartamento-residencial-moema-1-dormitorios', city_id: '470ab687-dbb7-4606-a3b8-8573ed6d6f48', state_id: '3af8b20a-1736-40a7-b055-e01164fb0b2c' },
  { slug: '1-lote-residencial-boa-vista', city_id: 'c-sem-nome', state_id: 'e4b329c4-1662-4641-87e7-3109672a7a56' },
];
const cidades = [{ id: '470ab687-dbb7-4606-a3b8-8573ed6d6f48', name: 'São Paulo' }];
const estados = [{ id: '3af8b20a-1736-40a7-b055-e01164fb0b2c', code: 'SP' }, { id: 'e4b329c4-1662-4641-87e7-3109672a7a56', code: 'ce' }];

const moema = { url_lote: U('5-apartamento-residencial-moema-1-dormitorios'), cidade: null, estado: null };
const boaVista = { url_lote: U('1-lote-residencial-boa-vista'), cidade: null, estado: null };       // cidade ausente na API
const jaTinha = { url_lote: U('5-apartamento-residencial-moema-1-dormitorios'), cidade: 'Onda Verde', estado: 'SP' };
const desconhecido = { url_lote: U('99-nao-existe'), cidade: null, estado: null };

const r = aplicarLocalizacao([moema, boaVista, jaTinha, desconhecido], lotes, cidades, estados);
assert.deepEqual({ cidade: moema.cidade, estado: moema.estado }, { cidade: 'São Paulo', estado: 'SP' });
assert.equal(boaVista.cidade, null);                    // sem nome de cidade → não inventa
assert.deepEqual([jaTinha.cidade, jaTinha.estado], ['Onda Verde', 'SP']); // nunca sobrescreve o parser
assert.equal(desconhecido.cidade, null);
assert.deepEqual(r, { preenchidos: 1, semDado: 2 });
console.log('✓ albertomacedo-localizacao-api: 4 casos');
