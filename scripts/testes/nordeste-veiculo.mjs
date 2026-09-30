// Veículos da NORDESTE (30/09): só veículo INTEIRO entra; marca/modelo/ano do título; placa, chassi,
// Renavam e local da DESCRIÇÃO do lote. Slugs e título reais do evento 213 (TRT-5).
import assert from 'node:assert/strict';
import { ehVeiculoInteiro, marcaModeloAno, tipoVeiculo } from '../lib/nordeste-veiculo.mjs';

const U = (s) => `https://www.nordesteleiloes.com.br/lotes/${s}`;
assert.ok(ehVeiculoInteiro(U('213-065-automovel-chevrolets10-ltz-dd2-28-tdi-4x2-cd-dies-aut-ano-20122013')));
assert.ok(ehVeiculoInteiro(U('213-001-motocicleta-yamahaybr125i-factor-ed-ano-20212022')));
assert.ok(ehVeiculoInteiro(U('213-027-veiculo-itoyota-hilux-4cd-sr5-ano-19981998')));
assert.ok(ehVeiculoInteiro(U('213-066-onibus-marcamodelo-mbenzmpolo-sen-midi-on-ano-20062006')));
assert.ok(!ehVeiculoInteiro(U('128-010-sucata-de-motocicleta-honda-cg-titan')), 'sucata fora');
assert.ok(!ehVeiculoInteiro(U('213-024-embarcacao-costa-do-sol-ii')), 'embarcação não é veículo');
assert.ok(!ehVeiculoInteiro(U('213-053-apartamento-itabunaba')));
assert.ok(!ehVeiculoInteiro(U('213-010-freezer-esmaltec-468l')));

assert.deepEqual(marcaModeloAno('AUTOMÓVEL CHEVROLET/S10 LTZ DD2 2.8 TDI 4X2 CD DIES. AUT, ANO 2012/2013'),
  { marca: 'CHEVROLET', modelo: 'S10 LTZ DD2 2.8 TDI 4X2 CD DIES. AUT', ano_fabricacao: 2012, ano_modelo: 2013 });
const hilux = marcaModeloAno('VEÍCULO I/TOYOTA HILUX 4CD SR5, ANO 1998/1998');
assert.equal(hilux.marca, 'TOYOTA'); assert.equal(hilux.modelo, 'HILUX 4CD SR5'); assert.equal(hilux.ano_modelo, 1998);
assert.equal(marcaModeloAno('MOTOCICLETA HONDA/CG 160 FAN, ANO 2018/2018').marca, 'HONDA');
assert.equal(tipoVeiculo('MOTOCICLETA HONDA/CG 160 FAN'), 'moto');
assert.equal(tipoVeiculo('ÔNIBUS M.BENZ/MPOLO SEN MIDI'), 'onibus');
assert.equal(tipoVeiculo('AUTOMÓVEL CHEVROLET/S10'), 'carro');
console.log('nordeste-veiculo: todos os casos passaram');
