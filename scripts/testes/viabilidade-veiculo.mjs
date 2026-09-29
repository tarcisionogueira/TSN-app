/**
 * scripts/testes/viabilidade-veiculo.mjs — 29/09. Teto de lance (arrematação + comissão + despesas
 * ≤ 65% da FIPE) e deságio realista da FIPE. Caso real do print: Fiat Cronos 2020, 264 mil km,
 * frota pública, FIPE R$ 60.549, lance mínimo R$ 22.000.
 */
import { desagioFipe, calcularViabilidade, planoParcelado } from '../../src/utils/viabilidadeVeiculo.js';
import { mdSimplesParaHtml } from '../../src/utils/mdSimples.js';

let falhas = 0;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

console.log('\nviabilidade do veículo');
const d = desagioFipe({ ano_modelo: 2020, km: 264131, origem_venda: 'orgao_publico' }, 2026);
ok(d.pct === 27, `Cronos 2020, 264 mil km, frota pública → deságio 27% (leilão 10 + km 12 + frota 5) — veio ${d.pct}`);
const r = calcularViabilidade({ fipe: 60549, lanceMinimo: 22000, comissaoPct: 5, despesas: [{ item: '4 pneus', valor: 1600 }, { item: 'Bateria', valor: 450 }], desagioPct: d.pct });
ok(r.tetoAquisicao === 39356.85, `teto de aquisição = 65% da FIPE = ${r.tetoAquisicao}`);
ok(r.tetoLance === 35530.33, `teto de lance = (39.356,85 − 2.050) / 1,05 = ${r.tetoLance}`);
ok(r.investimentoNoMinimo === 25150, `investimento no lance mínimo = 22.000 × 1,05 + 2.050 = ${r.investimentoNoMinimo}`);
ok(r.fipeRealista === 44200.77 && r.lucroNoMinimo === 19050.77, `revenda realista ${r.fipeRealista} · lucro no mínimo ${r.lucroNoMinimo}`);
ok(r.fechaNaRegra === true, 'lance mínimo cabe no teto');
ok(calcularViabilidade({ fipe: 50000, lanceMinimo: 40000 }).fechaNaRegra === false && calcularViabilidade({ fipe: 50000, lanceMinimo: 40000 }).comissaoPresumida, 'acima do teto não fecha; comissão ausente = presumida 5%');
ok(desagioFipe({ is_sucata: true }).pct === 60, 'deságio tem teto de 60%');
ok(calcularViabilidade({ fipe: 0, lanceMinimo: 1000 }) === null, 'sem FIPE não inventa cálculo');
ok(mdSimplesParaHtml('## Título\n**forte** <b>x</b>\n- item') === '<h4>Título</h4><p><strong>forte</strong> &lt;b&gt;x&lt;/b&gt;</p><ul><li>item</li></ul>', 'markdown simples escapa HTML e converte título/negrito/lista');

const pp = planoParcelado({ lance: 40000, comissaoPct: 5, despesasTotal: 1000, entradaPct: 25, parcelas: 10 });
ok(pp.sinal === 13000 && pp.valorParcela === 3000 && pp.saldo === 30000, `parcelado 25% + 10x: sinal = 10.000 + 2.000 comissão + 1.000 débitos = ${pp.sinal}; 10× ${pp.valorParcela}`);
ok(planoParcelado({ lance: 40000, entradaPct: 100, parcelas: 10 }) === null && planoParcelado({ lance: 40000, entradaPct: 25, parcelas: 1 }) === null, 'sem entrada/parcelas válidas não inventa plano');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
