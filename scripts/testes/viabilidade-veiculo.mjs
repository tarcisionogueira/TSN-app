/**
 * scripts/testes/viabilidade-veiculo.mjs — 29/09. Teto de lance (arrematação + comissão + despesas
 * ≤ 65% da FIPE) e deságio realista da FIPE. Caso real do print: Fiat Cronos 2020, 264 mil km,
 * frota pública, FIPE R$ 60.549, lance mínimo R$ 22.000.
 */
import { desagioFipe, calcularViabilidade, planoParcelado, revendaPorAnuncios, extrairComissaoPct, extrairDebitosDeclarados } from '../../src/utils/viabilidadeVeiculo.js';
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
// 30/09 (dono): MÉDIA de todos os anúncios da Webmotors − 10% (não mais só os 5 mais baratos).
const rv = revendaPorAnuncios(anuncios, 84032);
ok(rv && rv.base === 'webmotors' && rv.anuncios.length === 6, `usa os 6 da Webmotors (URL webmotors.com.br vale como portal), a peça de R$ 9 mil fora e o "javascript:" (sem portal) fora — veio ${rv?.anuncios.length}`);
ok(rv.media === 93011.17 && rv.valor === 83710.05, `média de todos ${rv.media} − 10% = ${rv.valor}`);
ok(rv.anuncios.every((a) => a.url === null || /^https?:/.test(a.url)), 'link "javascript:" da IA nunca vira href');
const misto = revendaPorAnuncios([{ preco: 80000, portal: 'webmotors' }, { preco: 82000, portal: 'olx' }, { preco: 84000, portal: 'icarros' }], 84032);
ok(misto && misto.base === 'misto' && misto.media === 82000, 'Webmotors com menos de 3 → completa com outros portais e diz que é misto');
const fora = revendaPorAnuncios([80000, 81000, 82000, 83000, 160000].map((preco) => ({ preco, portal: 'webmotors' })), 84032);
ok(fora && fora.anuncios.length === 4 && fora.media === 81500, `anúncio a 1,9× da mediana (versão errada) sai antes da média — média ${fora?.media}`);
ok(revendaPorAnuncios([{ preco: 80000 }, { preco: 81000 }], 84032) === null, 'menos de 3 anúncios → sem revenda de mercado (usa a régua)');
const vm = calcularViabilidade({ fipe: 84032, lanceMinimo: 47000, despesas: [{ item: 'x', valor: 7900, origem: 'declarado' }], desagioPct: 10, revendaMercado: rv.valor });
ok(vm.fipeRealista === 83710.05 && vm.revendaPorMercado && vm.lucroNoMinimo === Math.round((83710.05 - (47000 * 1.05 + 7900)) * 100) / 100, `lucro usa a revenda de mercado: ${vm.lucroNoMinimo}`);
const semReparo = calcularViabilidade({ fipe: 60549, lanceMinimo: 22000, despesas: [{ item: 'Débitos', valor: 7473.15, origem: 'declarado' }, { item: '4 pneus', valor: 1600, origem: 'estimado' }] });
ok(semReparo.despesasTotal === 7473.15, `reparo estimado (pneus) é citado mas NÃO entra no teto — despesas ${semReparo.despesasTotal}`);

console.log('\ncomissão e débitos lidos do texto (frases reais do acervo, 30/09)');
ok(extrairComissaoPct('ComissÃ£o: 5.00% do valor do lance, Sedex: Valores') === 5, 'SODRÉ com acento corrompido → 5');
ok(extrairComissaoPct('Comissão do Leiloeiro de 5% (cinco por cento) sobre o preço') === 5, 'SUPERBID "Comissão do Leiloeiro de 5%" → 5');
ok(extrairComissaoPct('- 5% referente à comissão do leiloeiro, acrescido ao valor') === 5, '"5% referente à comissão" → 5');
ok(extrairComissaoPct('sinal de 20% e comissão de 7,5% sobre o lance') === 7.5, 'comissão diferente de 5% é lida (7,5)');
ok(extrairComissaoPct('apresentar à Comissão de Alienação o comprovante de 20% (vinte por cento)') === null, '"Comissão de Alienação" (colegiado) não é taxa');
ok(extrairComissaoPct('Além das comissões, o comprador deverá pagar encargos') === null, 'comissão sem percentual → null (a tela presume e diz)');
const deb = (t) => extrairDebitosDeclarados(t).map((d) => d.valor);
ok(deb('DÉBITOS: R$ 7.473,15 E TAXAS DE LICENCIAMENTO')[0] === 7473.15, 'Cronos do print: débitos R$ 7.473,15 entram');
ok(deb('DÉBITOS: R$ 7.473,15 E TAXAS ... Débitos em aberto: R$ 7.473,15 e taxas de licenciamento').length === 1, 'o mesmo débito citado duas vezes (topo e rodapé do Cronos) conta UMA vez');
ok(deb('Débitos em aberto: R$3502,98 Sujeito')[0] === 3502.98 && deb('Débitos em aberto: R$544,30Sujeito')[0] === 544.3, 'valor sem milhar e colado no texto');
ok(deb('DÉBITOS EM ABERTO: R$ 0,00 SUJEITO').length === 0 && deb('Débitos em aberto: NADA CONSTA').length === 0, 'zero / nada consta não viram débito');
ok(deb('será aplicada multa de R$ 200,00 (duzentos reais)').length === 0 && deb('Eventuais débitos até o valor de R$ 350,00').length === 0, 'multa por atraso e teto condicional NÃO são dívida do lote');
ok(deb('ComissÃ£o: 5.00% do valor do lance, DepÃ³sito de Bens: R$ 550,00, LogÃ­stica e/ou Despachante: 350,00, Outros DÃ©bitos: 123,00').join() === '550,350,123', 'taxas da SODRÉ (depósito, despachante, outros débitos)');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
