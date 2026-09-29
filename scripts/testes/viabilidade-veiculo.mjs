/**
 * scripts/testes/viabilidade-veiculo.mjs — 29/09. Teto de lance (arrematação + comissão + despesas
 * ≤ 65% da FIPE) e deságio realista da FIPE. Caso real do print: Fiat Cronos 2020, 264 mil km,
 * frota pública, FIPE R$ 60.549, lance mínimo R$ 22.000.
 */
import { desagioFipe, calcularViabilidade, planoParcelado, revendaPorAnuncios } from '../../src/utils/viabilidadeVeiculo.js';
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

const anuncios = [
  { preco: 83990, url: 'https://www.webmotors.com.br/a1', portal: 'webmotors' }, { preco: 83900, url: 'https://www.webmotors.com.br/a2' },
  { preco: 88000, url: 'https://www.webmotors.com.br/a3' }, { preco: 91777, url: 'https://www.webmotors.com.br/a4' },
  { preco: 85500, url: 'https://www.webmotors.com.br/a5' }, { preco: 124900, url: 'https://www.webmotors.com.br/a6' },
  { preco: 9000, titulo: 'para-choque', url: 'https://x.com/peca' }, { preco: 84500, url: 'javascript:alert(1)' },
];
const rv = revendaPorAnuncios(anuncios, 84032);
ok(rv && rv.anuncios.length === 5 && rv.anuncios[0].preco === 83900, `5 mais baratos, a peça de R$ 9 mil fora (abaixo de 30% da FIPE)`);
ok(rv.media === 85178 && rv.valor === 76660.2, `média ${rv.media} − 10% = ${rv.valor}`);
ok(rv.anuncios.every((a) => a.url === null || /^https?:/.test(a.url)) && rv.anuncios.some((a) => a.preco === 84500 && a.url === null), 'link "javascript:" da IA é descartado (vira null)');
ok(revendaPorAnuncios([{ preco: 80000 }, { preco: 81000 }], 84032) === null, 'menos de 3 anúncios → sem revenda de mercado (usa a régua)');
const vm = calcularViabilidade({ fipe: 84032, lanceMinimo: 47000, despesas: [{ item: 'x', valor: 7900 }], desagioPct: 10, revendaMercado: rv.valor });
ok(vm.fipeRealista === 76660.2 && vm.revendaPorMercado && vm.lucroNoMinimo === Math.round((76660.2 - (47000 * 1.05 + 7900)) * 100) / 100, `lucro usa a revenda de mercado: ${vm.lucroNoMinimo}`);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
