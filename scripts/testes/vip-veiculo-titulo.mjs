// VIP veículos (05/10): títulos REAIS do seco — marca em 10/21 e ano em 2/21 antes deste parser.
import assert from 'node:assert/strict';
import { marcaModeloAnoVIP } from '../lib/vip-veiculo.mjs';

const casos = [
  ['Ford, Modelo Courier 1.6 Flex, Ano 2008', ['FORD', 'Courier 1.6 Flex', null, 2008]],
  ['Fiat, Modelo tipo 1.6 IE, Ano 1995/1994', ['FIAT', 'tipo 1.6 IE', 1995, 1994]],
  ['Motocicleta Honda CG150 FAN ESDI, ano 2015', ['HONDA', 'CG150 FAN ESDI', null, 2015]],
  ['Motocicleta Yamaha, XTZ250 Lander, ano 2020', ['YAMAHA', 'XTZ250 Lander', null, 2020]],
  ['FIAT PALIO FIRE - ANO 15/16', ['FIAT', 'PALIO FIRE', 2015, 2016]],
  ['Chevrolet, Modelo D10/1000, Ano 1979', ['CHEVROLET', 'D10/1000', null, 1979]],
  // Padrão Detran continua pelo parser comum.
  ['VW/GOL 1.0, ANO 2012/2013', ['VOLKSWAGEN', 'GOL 1.0', 2012, 2013]],
];
for (const [t, esperado] of casos) {
  const r = marcaModeloAnoVIP(t);
  assert.deepEqual([r.marca, r.modelo, r.ano_fabricacao, r.ano_modelo], esperado, t);
}
// Ano fora da faixa não vira ano ("Ano 1000 km" não existe; protege contra número solto).
assert.equal(marcaModeloAnoVIP('Ford Ka, ano 3000').ano_modelo, null);
console.log('ok vip-veiculo-titulo');
