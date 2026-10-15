// Regra do dono (15/10): parcela n vence em entrada + 30×n (encadeado do PAGAMENTO da entrada, nunca da data com
// folga); "pagar até" = vencimento − folga, antecipado para dia útil (fim de semana, feriado nacional, Carnaval,
// Sexta-feira Santa, Corpus Christi).
import assert from 'node:assert/strict';
import { cronograma, proximaPendente } from '../../src/utils/parcelamentoArremate.js';
import { ehDiaUtil, feriadosBancarios } from '../../src/utils/feriados.js';

const p = { forma: 'parcelado', entrada_pct: 25, entrada_venc: '2026-09-16', parcelas: 16, pagas: [0] };
const c = cronograma(p, { valor: 548355.15, dataArrematacao: '2026-09-16' });
assert.equal(c.length, 17);
assert.equal(c[1].venc, '2026-10-16');                 // 30 dias
assert.equal(c[2].venc, '2026-11-15');                 // 60 dias, não "dia 16 do mês"
assert.equal(c[2].pagar_ate, '2026-11-13');            // 14/11 é sábado (e 15/11 feriado) → sexta 13/11
assert.equal(c[16].venc, '2028-01-09');                // 480 dias: a folga não acumula
assert.equal(Math.round(c.reduce((s, x) => s + x.valor, 0) * 100) / 100, 548355.15);

// entrada_paga_em manda no encadeamento quando existe
const c2 = cronograma({ ...p, entrada_paga_em: '2026-09-18' }, { valor: 548355.15, dataArrematacao: '2026-09-16' });
assert.equal(c2[1].venc, '2026-10-18');
// folga configurável
const c3 = cronograma({ ...p, folga_dias: 3 }, { valor: 548355.15, dataArrematacao: '2026-09-16' });
assert.equal(c3[1].pagar_ate, '2026-10-13');

// feriados móveis 2027 (Páscoa 28/03): Carnaval 08 e 09/02, Sexta Santa 26/03, Corpus Christi 27/05
const f27 = feriadosBancarios(2027);
for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27', '2027-11-20', '2027-12-25']) assert.ok(f27.has(d), d);
assert.equal(ehDiaUtil('2027-02-10'), true);           // quarta de cinzas: banco abre (meio período)

const prox = proximaPendente(c, '2026-10-15');
assert.equal(prox.idx, 1); assert.equal(prox.dias, 0); assert.equal(prox.dias_venc, 1);
console.log('ok cronograma 30 dias + feriados');
