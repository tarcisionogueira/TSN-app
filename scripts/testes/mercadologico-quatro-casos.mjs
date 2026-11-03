/**
 * npm run testar:mercadologico-4 — os quatro defeitos do relatório "Mercadológico + Viabilidade" achados pelo
 * dono em 03/11, cada um com os DADOS SALVOS da análise real (scripts/testes/fixtures/mercadologico-4-casos.json).
 *
 *  1. Peruíbe (57573ba9): edital lido (sinal 25%, 10 parcelas, mínimo R$ 5.000) e projeção com 30 parcelas do art. 895.
 *  2. Peruíbe: comparáveis de São Paulo e Bauru aprovando a operação como "viável, vale avançar".
 *  3. Pirituba (abd7ffd9): R$ 7.256 × R$ 6.684,69/m², 42 × 40 amostras e metodologia dizendo "mediana".
 *  4. Itu (9ba1ce0c): casa de 219,5 m² em 3.017,5 m² de terreno, excedente avaliado em zero.
 */
import { readFileSync } from 'node:fs';
import { aplicarCondicoesEdital, parcelaMinimaDoTexto } from '../../src/lib/condicoes-pagamento.js';
import { cidadeDaAmostra, ehOutraCidade } from '../../src/lib/origem-amostras.js';
import { avaliarTerrenoExcedente, fraseTerrenoExcedente } from '../../src/lib/terreno-excedente.js';
import { vereditoMercadologico, fraseOrigemAmostras, TEXTO_INDICATIVA_BASE, TEXTO_INDICATIVA_TERRENO } from '../../src/lib/veredito-mercadologico.js';
import { dedupVendasEntreNiveis, precoM2DoRelatorio, vendasDe } from '../../src/lib/niveis-mercado.js';
import { frasesMercadologico, fraseCondicoesPagamento } from '../../src/lib/nota-metodologica.js';
import { avaliarMercado } from '../../api/_valor-mercado.js';
import { extrairPagamentoTexto } from '../../api/_doc-extracao.js';
import { calcularMetricasCenario, calcularTetoLance } from '../../src/utils/calculos.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/mercadologico-4-casos.json', import.meta.url), 'utf8'));
let falhas = 0;
const ok = (cond, oque, extra) => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
};
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('\n1. PERUÍBE — condições do edital têm prioridade sobre o piso do art. 895');
{
  const P = F.peruibe;
  const ce = P.condicoesEdital;
  ok(parcelaMinimaDoTexto(ce.formaPagamento) === 5000, 'lê "mínimo de R$ 5.000,00 por parcela"');
  ok(extrairPagamentoTexto(ce.formaPagamento)?.parcelaMinima === 5000, 'o extrator do edital também grava a parcela mínima');
  const patch = aplicarCondicoesEdital(P.d, ce.regrasPagamento, ce.formaPagamento);
  ok(patch?.prazoMeses === 10 && patch?.sinalPercentual === 25, 'projeção passa a 25% de sinal e 10 parcelas', patch);
  ok(patch?.origemCondicoesPagamento === 'edital', 'origem vira "edital"', patch?.origemCondicoesPagamento);
  const dNovo = { ...P.d, ...patch };
  const antes = calcularMetricasCenario(P.d, 96000, false);
  const depois = calcularMetricasCenario(dNovo, 96000, false);
  ok(Math.round(antes.parcelaMedia) === 2400, 'antes: parcela de R$ 2.400 (30×)', antes.parcelaMedia);
  ok(Math.round(depois.parcelaMedia) === 7200 && depois.parcelaMedia >= 5000, 'depois: parcela de R$ 7.200 (10×), acima do mínimo do edital', depois.parcelaMedia);
  ok(Math.abs(depois.roi - antes.roi) > 0.01, 'ROE muda com as condições reais', { antes: antes.roi, depois: depois.roi });
  const tetoA = calcularTetoLance(P.d, false, 30, P.d.valorMercado), tetoD = calcularTetoLance(dNovo, false, 30, P.d.valorMercado);
  ok(Math.round(tetoA) !== Math.round(tetoD), 'teto de lance recalculado com as condições do edital', { antes: tetoA, depois: tetoD });
  const rodape = fraseCondicoesPagamento({ sinalPercentual: 25, prazoMeses: 10, origem: 'edital', parcelaMinima: 5000 });
  ok(/LIDAS NO EDITAL/.test(rodape) && !/NÃO confirmadas/.test(rodape) && /5\.000/.test(rodape), 'rodapé diz a origem real (edital) e a parcela mínima', rodape);

  // Parcela mínima LIMITA o número de parcelas quando o saldo não comporta.
  const pequeno = aplicarCondicoesEdital({ ...P.d, valorArrematacao: 40000 }, ce.regrasPagamento, ce.formaPagamento);
  ok(pequeno.prazoMeses === 6 && pequeno.parcelaMinimaAplicada, 'saldo de R$ 30 mil com mínimo de R$ 5 mil = 6 parcelas, não 10', pequeno);
  // 240× é financiamento (varredura de 03/11, Carapicuíba): juros não zeram e a condição não é confirmada.
  const fin = aplicarCondicoesEdital({ ...P.d, cetAnual: 0 }, { parcelas: 240, sinalPct: 5, parcelamentoPermitido: true }, 'entrada de 5% e saldo em até 240 parcelas');
  ok(fin.prazoMeses === 240 && fin.cetAnual === 12 && fin.origemCondicoesPagamento === 'edital_incompleto', '240 parcelas = financiamento: mantém juros de 12% a.a. e marca "edital_incompleto"', fin);
  // Edital incerto: permite parcelar e não diz em quantas vezes → não confirmado.
  const inc = aplicarCondicoesEdital(P.d, { parcelamentoPermitido: true }, 'é permitido o parcelamento do valor');
  ok(inc.origemCondicoesPagamento === 'edital_incompleto' && inc.faltando.length === 2, 'edital sem nº de parcelas nem sinal = "edital_incompleto"', inc);
  const rodInc = fraseCondicoesPagamento({ sinalPercentual: 25, prazoMeses: 30, origem: 'edital_incompleto', faltando: inc.faltando });
  ok(/NÃO confirmadas/.test(rodInc) && /PARCIALMENTE/.test(rodInc), 'rodapé avisa que a extração é incompleta e não confirma', rodInc);
  // O que o CLIENTE digitou fica.
  ok(aplicarCondicoesEdital({ ...P.d, sinalPercentual: 40, prazoMeses: 12, origemCondicoesPagamento: 'cliente' }, ce.regrasPagamento, ce.formaPagamento) === null, 'condição digitada pelo cliente não é sobrescrita');
  ok(aplicarCondicoesEdital({ ...P.d, sinalPercentual: 40, prazoMeses: 12, origemCondicoesPagamento: '' }, ce.regrasPagamento, ce.formaPagamento) === null, 'valor fora dos defaults sem marcador também é respeitado');
  // Edital que veda.
  ok(aplicarCondicoesEdital(P.d, { parcelamentoPermitido: false }, '')?.somenteAVista === true, 'edital que veda parcelamento trava à vista');
}

console.log('\n2. PERUÍBE — comparável de outra cidade não aprova operação');
{
  const P = F.peruibe;
  ok(cidadeDaAmostra({ endereco: 'Residencial Marinha do Arvoredo - Bauru - SP' }) === 'bauru', 'lê a cidade de "Bairro - Cidade - UF"');
  ok(cidadeDaAmostra({ endereco: 'Pirituba, São Paulo/SP' }) === 'sao paulo', 'lê a cidade de "Bairro, Cidade/UF"');
  ok(cidadeDaAmostra({ endereco: 'Condomínio Fazenda Vila Real de Itu' }) === null, 'sem cidade explícita = não sabe (não descarta)');
  ok(P.nivel3.vendas.every(a => ehOutraCidade(a, 'Peruíbe')), 'as 3 amostras de Peruíbe são de outra cidade');
  const av = avaliarMercado({ nivel1: P.nivel1.vendas, nivel2: P.nivel2.vendas, nivel3: P.nivel3.vendas, lote: { cidade: 'Peruíbe' } });
  ok(av.consolidado.n === 0 && av.descartadas.filter(d => d._motivo === 'outra_cidade').length === 3, 'a régua do m² descarta as 3 por "outra_cidade"', { n: av.consolidado.n });
  // Relatório JÁ EMITIDO (sem baseLocal gravado): a tela recalcula das amostras salvas.
  const mercadoSalvo = clone(P);
  const v = vereditoMercadologico({ isViavel: true, mercado: mercadoSalvo, cidade: 'Peruíbe' });
  ok(v.estado === 'indicativa' && v.texto === TEXTO_INDICATIVA_BASE, 'selo do relatório salvo vira "Viabilidade indicativa"', v);
  const base = fraseOrigemAmostras(mercadoSalvo, 'Peruíbe', 3);
  ok(/outras cidades/.test(base) && /Bauru/.test(base) && !/mesmo tipo\/região/.test(base), 'Base de mercado diz a origem real', base);
  const met = frasesMercadologico(mercadoSalvo, null, 'Peruíbe').join(' ');
  ok(/outras cidades/.test(met) && !/~250 m e entorno até ~1 km/.test(met), 'metodologia não cita recortes de ~1 km para amostra de outra cidade', met.slice(0, 220));
  // Servidor novo: baseLocal gravado.
  const novo = { ...clone(P), baseLocal: { locais: 0, foraDaCidade: 3, cidadesFora: ['São Paulo', 'Bauru'], suficiente: false } };
  ok(vereditoMercadologico({ isViavel: true, mercado: novo, cidade: 'Peruíbe' }).estado === 'indicativa', 'com baseLocal gravado pelo servidor, mesmo veredito');
  // Controle: base local suficiente continua "viável".
  const pir = { nivel1: F.pirituba.nivel1, nivel2: F.pirituba.nivel2 };
  ok(vereditoMercadologico({ isViavel: true, mercado: pir, cidade: 'Sao Paulo' }).estado === 'viavel', 'controle: Pirituba (40 locais) segue "viável"');
}

console.log('\n3. PIRITUBA — um R$/m² e uma contagem só; metodologia descreve a conta real');
{
  const P = F.pirituba;
  ok(precoM2DoRelatorio(P) === 6684.69, 'relatório salvo: o Resumo passa a mostrar R$ 6.684,69 (não R$ 7.256)', precoM2DoRelatorio(P));
  // Reproduz a duplicata entre níveis que inflou a conta para 42: repete 2 anúncios do nível 1 no nível 2.
  const m = clone(P);
  m.nivel2.vendas.push(clone(m.nivel1.vendas[0]), clone(m.nivel1.vendas[1]));
  const comDup = avaliarMercado({ nivel1: m.nivel1.vendas, nivel2: m.nivel2.vendas, nivel3: [], lote: { cidade: 'Sao Paulo' } });
  const removidas = dedupVendasEntreNiveis(m);
  const semDup = avaliarMercado({ nivel1: m.nivel1.vendas, nivel2: m.nivel2.vendas, nivel3: [], lote: { cidade: 'Sao Paulo' } });
  ok(removidas === 2, 'dedup antes da conta remove as 2 repetições', removidas);
  ok(semDup.consolidado.n === comDup.consolidado.n - 2, 'a conta passa a usar as amostras únicas', { com: comDup.consolidado.n, sem: semDup.consolidado.n });
  ok(semDup.consolidado.n === vendasDe(m).length - semDup.descartadas.length, 'nº da conta = nº listado − descartados com motivo', { n: semDup.consolidado.n, listadas: vendasDe(m).length, desc: semDup.descartadas.length });
  ok(Math.abs(semDup.consolidado.precoMedioM2 - comDup.consolidado.precoMedioM2) > 1, 'a repetição enviesava o R$/m²', { com: comDup.consolidado.precoMedioM2, sem: semDup.consolidado.precoMedioM2 });
  const met = frasesMercadologico(P, null, 'Sao Paulo').join(' ');
  ok(!/MEDIANA das amostras/.test(met) && /MÉDIA PONDERADA/.test(met), 'metodologia descreve média ponderada, não mediana', met.match(/O preço por m²[^.]*\./)?.[0]);
}

console.log('\n4. ITU — terreno excedente detectado; áreas certas na viabilidade');
{
  const I = F.itu;
  const semIndice = avaliarTerrenoExcedente({ tipo: 'casa', areaConstruidaM2: 219.5, areaTerrenoM2: 3017.5, indiceTerreno: null });
  ok(semIndice.haExcedente && !semIndice.avaliado && semIndice.areaExcedenteM2 === 2359, 'detecta ~2.359 m² de excedente (3.017,5 − 3×219,5)', semIndice);
  ok(/não avaliado/.test(fraseTerrenoExcedente(semIndice)), 'sem preço de terreno: avisa que o terreno não foi avaliado', fraseTerrenoExcedente(semIndice));
  const comIndice = avaliarTerrenoExcedente({ tipo: 'casa', areaConstruidaM2: 219.5, areaTerrenoM2: 3017.5, indiceTerreno: { venda_m2: 400, n_amostras: 12, nivel: 'cidade' } });
  ok(comIndice.avaliado && comIndice.valorTerrenoExcedente === 943600, 'com Índice de terreno (cidade, 12 amostras): 2.359 m² × R$ 400 = R$ 943.600', comIndice);
  ok(!avaliarTerrenoExcedente({ tipo: 'casa', areaConstruidaM2: 219.5, areaTerrenoM2: 3017.5, indiceTerreno: { venda_m2: 400, n_amostras: 30, nivel: 'estado' } }).avaliado, 'índice de ESTADO não precifica o terreno');
  ok(!avaliarTerrenoExcedente({ tipo: 'casa', areaConstruidaM2: 150, areaTerrenoM2: 360 }).haExcedente, 'controle: casa de 150 m² em lote de 360 m² não tem excedente');
  ok(!avaliarTerrenoExcedente({ tipo: 'apartamento', areaConstruidaM2: 80, areaTerrenoM2: 5000 }).haExcedente, 'controle: apartamento (fração do terreno) não tem excedente');
  // Selo: reprovada com terreno não avaliado vira indicativa.
  const mercado = { ...clone(I), consolidado: { ...I.consolidado, terrenoExcedente: semIndice } };
  const v = vereditoMercadologico({ isViavel: false, mercado, cidade: 'Itu' });
  ok(v.estado === 'indicativa' && v.texto === TEXTO_INDICATIVA_TERRENO, 'operação reprovada com terreno não avaliado vira "indicativa"', v);
  // Viabilidade com as áreas do mercado (o que o servidor faz no pInp).
  const pInp = { ...I.d };
  if (Number(I.mercadoInputs.areaM2) > 0) pInp.areaM2 = I.mercadoInputs.areaM2;
  if (Number(I.mercadoInputs.areaTerrenoM2) > 0) pInp.areaTerrenoM2 = I.mercadoInputs.areaTerrenoM2;
  ok(pInp.areaM2 === 219.5 && pInp.areaTerrenoM2 === 3017.5, 'viabilidade recebe 219,5 m² construídos e 3.017,5 m² de terreno', { areaM2: pInp.areaM2, areaTerrenoM2: pInp.areaTerrenoM2 });
  ok(/Terreno excedente/.test(frasesMercadologico(mercado, null, 'Itu').join(' ')), 'metodologia cita o terreno excedente');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ todos os casos passaram');
process.exit(falhas ? 1 : 0);
