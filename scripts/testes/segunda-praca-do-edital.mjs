// #37 (05/10): valor da 2ª praça lido do edital. Frases no formato dos editais judiciais.
import assert from 'node:assert/strict';
import { extrairSegundaPraca } from '../../api/_segunda-praca.js';

const casos = [
  ['No segundo leilão, o bem será vendido pelo maior lance, desde que não inferior a 50% (cinquenta por cento) do valor da avaliação.', { valorAvaliacao: 230000 }, 50, 115000],
  ['2º Leilão: dia 27/10/2026 às 14h, com lance mínimo de 60% do valor atualizado da avaliação.', { valorAvaliacao: 100000 }, 60, 60000],
  ['SEGUNDA PRAÇA: a partir de 10/11, por valor igual ou superior a 70% da avaliação', {}, 70, null],
  ['Na 2ª praça, lance mínimo de R$ 150.000,00 (cento e cinquenta mil reais).', { valorMinimo: 300000, valorAvaliacao: 300000 }, 50, 150000],
];
for (const [t, ctx, pct, valor] of casos) {
  const r = extrairSegundaPraca(t, ctx);
  assert.ok(r, `não achou: ${t}`);
  assert.equal(r.pct, pct, t);
  assert.equal(r.valor, valor, t);
}
// NÃO pode pegar: sinal, comissão, parcela — e R$ em edital de vários lotes.
const negativos = [
  ['No segundo leilão o arrematante pagará sinal de 25% do valor do lance e o saldo em 30 parcelas.', {}],
  ['Segundo leilão: comissão do leiloeiro de 5% sobre o valor da arrematação.', {}],
  ['2º leilão em 20/10. Lote 1 R$ 80.000,00; Lote 2 R$ 95.000,00', { multiLote: true, valorMinimo: 200000 }],
  ['2º leilão em 20/10, lance R$ 500.000,00', { valorMinimo: 300000 }], // acima da 1ª praça
  ['segundo leilão não poderá ser aceito lance inferior aos seguintes limites: a) Veículos automotores em geral: mínimo de 50% do valor da avaliação; b) Imóveis: 60%', {}],
  ['O imóvel foi avaliado e o 1º leilão será em 10/10 pelo valor de 100% da avaliação.', {}],
];
for (const [t, ctx] of negativos) assert.equal(extrairSegundaPraca(t, ctx), null, `pegou indevidamente: ${t}`);
console.log(`ok — segunda praça: ${casos.length} positivos, ${negativos.length} negativos`);
