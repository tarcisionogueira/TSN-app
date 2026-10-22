// Localização de item de PACOTE da ALBERTOMACEDO pela API do site (03/10). Dados REAIS do recon
// de 03/10 (pacote "Imóveis em CE, GO, PR e SP"): Moema → city "São Paulo" / state "SP".
import assert from 'node:assert/strict';
import { aplicarLocalizacao, aplicarDocumentos } from '../lib/albertomacedo-api.mjs';

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

// DOCUMENTOS pela lot_documents (22/10): slug casa direto; evento (uuid) só com lote único; .bin fora.
const B = 'https://albertomacedoleiloes.com.br';
const ev1 = '11111111-1111-1111-1111-111111111111', ev2 = '22222222-2222-2222-2222-222222222222';
const rSlug = { url_lote: `${B}/lote/3-casa-moema`, link_edital: `${B}/lote/3-casa-moema` };
const rEv1 = { url_lote: `${B}/leilao/${ev1}` };
const rEv2 = { url_lote: `${B}/leilao/${ev2}` };
const lotesD = [{ id: 'L1', slug: '3-casa-moema' }, { id: 'L2', slug: 'x', auction_id: ev1 }, { id: 'L3', slug: 'y', auction_id: ev2 }, { id: 'L4', slug: 'z', auction_id: ev2 }];
const docsD = [
  { lot_id: 'L1', title: 'Edital', file_url: 'https://api.x/lot-files/L1/documents/a.pdf', document_type: 'edital' },
  { lot_id: 'L1', title: 'Matrícula', file_url: 'https://api.x/lot-files/L1/documents/b.pdf', document_type: 'matricula' },
  { lot_id: 'L1', title: 'Outro', file_url: 'https://api.x/lot-files/L1/documents/c.bin', document_type: 'outros' },
  { lot_id: 'L2', title: 'Laudo', file_url: 'https://api.x/lot-files/L2/documents/d.pdf', document_type: 'avaliacao' },
  { lot_id: 'L3', title: 'Edital', file_url: 'https://api.x/lot-files/L3/documents/e.pdf', document_type: 'edital' },
];
const rd = aplicarDocumentos([rSlug, rEv1, rEv2], lotesD, docsD);
assert.equal(rSlug.anexos.length, 2);                                   // .bin fora
assert.equal(rSlug.link_edital, 'https://api.x/lot-files/L1/documents/a.pdf'); // placeholder trocado pelo PDF
assert.equal(rSlug.link_matricula, 'https://api.x/lot-files/L1/documents/b.pdf');
assert.equal(rEv1.anexos[0].tipo, 'laudo');                             // evento com 1 lote: casa
assert.equal(rEv2.anexos, undefined);                                   // pacote (2 lotes): não chuta
assert.deepEqual(rd, { comDoc: 2 });
console.log('✓ albertomacedo-documentos-api: 5 casos');
