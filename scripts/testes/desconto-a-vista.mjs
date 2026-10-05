// Desconto à vista (05/10, edital Bradesco do Alphaville): 10% sobre o lance à vista; comissão de 5%
// sobre o LANCE cheio; ITBI sobre o preço pago. Sem desconto, a conta é a de sempre.
import assert from 'node:assert/strict';
import { calcularMetricasCenario } from '../../src/utils/calculos.js';

const base = { valorMercado: 3376396, taxaLeiloeiroPercentual: 5, itbiPercentual: 5, honorariosPercentual: 10, prazoVendaMeses: 12, debitosAssumidos: 20000 };
const sem = calcularMetricasCenario(base, 2121000, true);
const com = calcularMetricasCenario({ ...base, descontoAVistaPercentual: 10 }, 2121000, true);
assert.equal(sem.valorPago, 2121000);
assert.equal(com.valorPago, 1908900, 'paga 90% do lance');
assert.equal(com.taxaLeiloeiro, 106050, 'comissão 5% sobre o lance cheio');
assert.equal(com.itbiRegistro, 1908900 * 0.05, 'ITBI sobre o preço pago');
assert.equal(com.desembolsoInicial, sem.desembolsoInicial - 212100 - 10605, 'caixa cai o desconto + ITBI do desconto');
assert.ok(com.lucro > sem.lucro);
// Parcelado ignora o desconto (é só à vista).
const parc = calcularMetricasCenario({ ...base, descontoAVistaPercentual: 10, sinalPercentual: 25, prazoMeses: 12, cetAnual: 0 }, 2121000, false);
assert.equal(parc.valorSinal, 2121000 * 0.25);
assert.equal(parc.itbiRegistro, 2121000 * 0.05);
console.log('ok desconto-a-vista');
