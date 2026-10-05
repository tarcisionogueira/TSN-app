// ASTAVERO veículos (05/10, #139): descrições REAIS do oficial de justiça (Damiani, Mazzolli, DBS).
import assert from 'node:assert/strict';
import { veiculoDaDescricao, montarRowVeiculoAstavero, TENANTS } from '../lib/astavero-json.mjs';
import { marcaModeloAno, tipoVeiculo } from '../lib/nordeste-veiculo.mjs';

const fluence = veiculoDaDescricao('01.1) 01 (um) automóvel, marca Renault, modelo Fluence Pri20A, ano fabricação 2011, ano modelo 2012, placa AUQ-1G87, renavam 377552542, movido a álcool e gasolina, cor preta. Avaliação: R$ 38.663,00. Local para vistoria: rua Mato Grosso, n.º 1274, bairro Itacolomi, em Balneário Piçarras (SC).');
assert.deepEqual([fluence.marca, fluence.modelo, fluence.ano_fabricacao, fluence.ano_modelo, fluence.placa, fluence.renavam, fluence.combustivel, fluence.cor],
  ['RENAULT', 'Fluence Pri20A', 2011, 2012, 'AUQ1G87', '377552542', 'flex', 'preta']);
assert.match(fluence.vistoria, /Mato Grosso.*Piçarras/);

const tiguan = veiculoDaDescricao('Bens: 1) 01 (um) veículo I/VW TIGUAN 2.0 TSI (Importado), ano/modelo 2013/2014, placas MIV5690, renavam 596281307, cor branca.', 'TIGUAN 2.0');
assert.deepEqual([tiguan.marca, tiguan.modelo, tiguan.ano_fabricacao, tiguan.ano_modelo, tiguan.placa], ['VOLKSWAGEN', 'TIGUAN 2.0 TSI', 2013, 2014, 'MIV5690']);

const cbx = veiculoDaDescricao('Bem: 01 (uma) HONDA/CBX 250 TWISTER(Nacional), ano/modelo 2008/2008, placas MEP5165, renavam 977242846, cor preta, chassi: 9C2MC35008R078030, nº motor: MC35E8078030.');
assert.deepEqual([cbx.marca, cbx.modelo, cbx.chassi, cbx.ano_modelo], ['HONDA', 'CBX 250 TWISTER', '9C2MC35008R078030', 2008]);

const voyage = veiculoDaDescricao('UM AUTOMÓVEL, marca VW, modelo Voyage 1.6 Trend, ano 2010 e modelo 2011, placa MHJ0518, Renavam 253291526, flex, prata. Vistoria: Rua Francisco de Paula Ramos, nº 66, bairro Coral, Lages – SC.');
assert.deepEqual([voyage.marca, voyage.modelo, voyage.ano_fabricacao, voyage.ano_modelo, voyage.combustivel], ['VOLKSWAGEN', 'Voyage 1.6 Trend', 2010, 2011, 'flex']);

// Linha completa: nome pobre ("TIGUAN 2.0"), descrição rica; tipo pela descrição; sucata pela plataforma.
const tenant = TENANTS.find((t) => t.fonte === 'MAZZOLLILEILOES');
const item = { id: '6a9735c753274814f0588554', leilao: 'L1', nome: 'TIGUAN 2.0', local: 'Florianópolis - SC', praca: 1, valor: 69000, avaliacao: 69000, image: 'https://x/foto.jpg', data: '2026-10-22T19:15:00.000Z' };
const row = montarRowVeiculoAstavero(item, { leilao: { datas: { d1: '2026-10-22T19:15:00.000Z' } }, lote: { v: { avaliacao: 69000, primeira: 69000, segunda: 34500 }, p: { processo: '5000001-00.2024.8.24.0023' },
  d: { cidade: 'Florianópolis', uf: 'SC' }, sucata: false, detalhada: '<p>01 (um) veículo I/VW TIGUAN 2.0 TSI (Importado), ano/modelo 2013/2014, placas MIV5690</p>' } }, tenant, { marcaModeloAno, tipoVeiculo });
assert.equal(row.fonte_id, 'mazzollileiloes_6a9735c753274814f0588554');
assert.deepEqual([row.marca, row.ano_modelo, row.tipo_veiculo, row.modalidade, row.is_sucata, row.status_patio], ['VOLKSWAGEN', 2014, 'carro', 'judicial', false, 'indefinido']);
assert.deepEqual(row.fotos, ['https://x/foto.jpg']);
assert.equal(row.raw.segunda_praca, 34500);
const moto = montarRowVeiculoAstavero({ ...item, nome: 'CBX 250 TWISTER' }, { lote: { sucata: true, detalhada: 'HONDA/CBX 250 TWISTER(Nacional), ano/modelo 2008/2008' } }, tenant, { marcaModeloAno, tipoVeiculo });
assert.deepEqual([moto.tipo_veiculo, moto.is_sucata], ['moto', true]);
console.log('astavero-veiculo: todos os casos passaram');
