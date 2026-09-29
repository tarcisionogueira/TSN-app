/**
 * scripts/testes/parcelamento-arremate.mjs — 29/09. Cronograma de pagamento da arrematação: a tela
 * e o cron de aviso usam a mesma regra (src/utils/parcelamentoArremate.js).
 */
import { cronograma, proximaPendente, somarMeses, avisoPenalidade } from '../../src/utils/parcelamentoArremate.js';

let falhas = 0;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

console.log('\nparcelamento da arrematação');
ok(somarMeses('2026-01-31', 1) === '2026-02-28', '31/01 + 1 mês = 28/02 (último dia do mês)');
ok(somarMeses('2026-09-16', 12) === '2027-09-16', '+12 meses mantém o dia');

const c = cronograma({ forma: 'parcelado', entrada_pct: 25, entrada_venc: '2026-09-17', parcelas: 30, primeira_venc: '2026-10-16', pagas: [0] },
  { valor: 548355.15, dataArrematacao: '2026-09-16' });
ok(c.length === 31, 'entrada + 30 parcelas');
ok(c[0].valor === 137088.79 && c[0].paga, 'entrada 25% = R$ 137.088,79, marcada paga');
ok(Math.abs(c.reduce((s, x) => s + x.valor, 0) - 548355.15) < 0.005, 'soma fecha exatamente com o valor arrematado');
ok(c[30].venc === '2029-03-16', '30ª parcela em 16/03/2029');
const prox = proximaPendente(c, '2026-10-11');
ok(prox.idx === 1 && prox.dias === 5, 'próxima pendente = parcela 1, faltam 5 dias');
ok(proximaPendente(c, '2026-10-20').dias === -4, 'atrasada = dias negativos');
ok(cronograma({ forma: 'a_vista' }, { valor: 100000, dataArrematacao: '2026-09-16' })[0].venc === '2026-09-16', 'à vista sem data própria vence na data da arrematação');
ok(cronograma({ forma: 'parcelado', parcelas: 10 }, { valor: 0, dataArrematacao: '2026-09-16' }).length === 0, 'sem valor não inventa cronograma');
ok(/art\. 895/.test(avisoPenalidade('judicial')) && !/art\. 895/.test(avisoPenalidade('extrajudicial')), 'multa do CPC só no judicial');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
