/**
 * npm run testar:valor-mercado — o nível 3 (1km-2km) tem que ENTRAR na conta do R$/m², não só
 * aparecer na tela.
 *
 * POR QUE EXISTE (10/09, achado do dono lendo o próprio relatório): "no tópico aonde mostra o
 * nível um, nível dois, apareciam zero amostras, e no tópico onde a amostra é mostrada por
 * período de tempo, aparecia um volume de amostras" + "o valor do metro de acordo com as
 * amostras e a quantidade de amostras não estava de acordo". As duas queixas eram o MESMO bug:
 * `api/gerar-analise.js` já passava `nivel3: mercado?.nivel3?.vendas` para `avaliarMercado()`
 * desde 09/09 (regra do dono, ver src/lib/niveis-mercado.js), mas a ASSINATURA da função em
 * `api/_valor-mercado.js` nunca declarou esse parâmetro — o destructuring `{ nivel1 = [],
 * nivel2 = [], lote, minAmostras }` descartava `nivel3` em silêncio. Nível 3 só existe
 * (regra do prompt) quando nível 1+2 somam MENOS de 10 amostras — ou seja, exatamente no caso
 * em que nível 3 é a ÚNICA fonte real de dado, `avaliarMercado` devolvia `consolidado.n = 0`
 * (nível 1+2 vazios, nível 3 ignorado) e a tela "nível 1, nível 2" mostrava zero — enquanto a
 * aba "por período" (que soma pelos helpers de src/lib/niveis-mercado.js, esses SIM cientes do
 * nível 3) mostrava volume de amostra de verdade. E como o `n=0` também é o gate que decide se
 * `mercado.valorPonderado` é escrito (`if (avalPond.consolidado.n > 0 ...)`), o cabeçalho ficava
 * com o valor de m² ANTIGO da IA (não sobrescrito) ao lado de uma contagem de amostra que não
 * batia com ele — a segunda queixa do dono.
 *
 * Efeito colateral que este teste também tranca: `gerar-analise.js` já iterava
 * `NIVEIS.map(k => [k, avalPond[k]])` (as TRÊS chaves) e lia `r.usadas` — sem `nivel3` no
 * retorno de `consolidarM2`, isso é `undefined.usadas` (TypeError) sempre que nível 1 OU nível 2
 * tivesse ALGUMA amostra ao lado de um nível 3 povoado. O catch engolia o erro e a análise
 * saía sem NENHUM refinamento (nem nível 1, nem nível 2, nem o valor ponderado).
 */
import { avaliarMercado, consolidarM2, prepararAmostras, TETO_KM, pesoProximidade } from '../../api/_valor-mercado.js';

let falhas = 0;
const ok = (cond, oque, extra) => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
};

const venda = (valorM2, distanciaKm, extra = {}) => ({ valor: valorM2 * 60, m2: 60, valorM2, distanciaKm, fonte: 'anuncio-teste', ...extra });

console.log('\nO CENÁRIO EXATO DO ACHADO: nível 1 e 2 vazios, nível 3 é a única amostra real');
{
  const nivel3 = [venda(5000, 1.5), venda(5200, 1.8), venda(4900, 1.2)];
  const r = avaliarMercado({ nivel1: [], nivel2: [], nivel3, minAmostras: 10 });
  ok(r.consolidado.n === 3, 'consolidado.n conta as 3 amostras do nível 3 (antes do fix: 0)', r.consolidado.n);
  ok(r.consolidado.precoMedioM2 > 0, 'precoMedioM2 sai calculado, não zero', r.consolidado.precoMedioM2);
  ok(r.nivel3 && r.nivel3.usadas.length === 3, 'o retorno tem a chave nivel3, com as 3 amostras usadas');
}

console.log('\nA MESMA ITERAÇÃO QUE gerar-analise.js FAZ NÃO PODE MAIS QUEBRAR');
{
  // Reproduz exatamente NIVEIS.map(k => [k, avalPond[k]]) seguido de r.usadas — o crash real
  // quando nível 1 (ou 2) tem amostra AO LADO de nível 3 povoado (o outro ramo do bug: antes,
  // avalPond.nivel3 era `undefined`, e `undefined.usadas` derrubava a análise inteira).
  const NIVEIS = ['nivel1', 'nivel2', 'nivel3'];
  const avalPond = avaliarMercado({
    nivel1: [venda(6000, 0.1)], nivel2: [venda(5800, 0.6)], nivel3: [venda(5000, 1.5)],
  });
  let quebrou = false, tocados = 0;
  try {
    for (const k of NIVEIS) { const r = avalPond[k]; void r.usadas; tocados++; }
  } catch { quebrou = true; }
  ok(!quebrou, 'iterar as 3 chaves e ler .usadas em cada uma não lança (era o crash silencioso)');
  ok(tocados === 3, 'as 3 chaves existem no retorno', tocados);
  ok(avalPond.consolidado.n === 3, 'as 3 amostras (1+1+1) entram juntas na conta consolidada');
}

console.log('\nNÍVEL 3 SEM distanciaKm: nominal é 2km (pior caso do PRÓPRIO balde), não 1km');
{
  const { usadas } = prepararAmostras([venda(5000, undefined)], { nivel: 3, tetoKm: TETO_KM.ampliado });
  ok(usadas.length === 1, 'a amostra sem distância ainda é aproveitada');
  ok(usadas[0]._dist === 2.0, `nominal = 2km (TETO_KM[3]), não 1km — veio ${usadas[0]._dist}`, usadas[0]._dist);
  ok(usadas[0]._distEstimada === true, 'marca a distância como estimada, não declarada');
}

console.log('\nNÍVEL 3 RESPEITA O TETO DE 2KM (o prompt proíbe qualquer amostra além disso)');
{
  const { usadas, descartadas } = prepararAmostras([venda(5000, 2.5)], { nivel: 3, tetoKm: TETO_KM.ampliado });
  ok(usadas.length === 0, 'amostra a 2,5km é descartada, mesmo sendo "nível 3"');
  ok(descartadas[0]?._motivo === 'fora_do_raio', 'motivo do descarte é fora_do_raio', descartadas[0]);
}

console.log('\nPESO MENOR (regra do prompt): nível 3 pesa menos que nível 1 na mesma média');
{
  const p1 = pesoProximidade(0.1);   // nível 1, bem perto
  const p3 = pesoProximidade(1.8);   // nível 3, longe
  ok(p1 > p3, `peso de amostra nível 1 (${p1}) > peso de amostra nível 3 (${p3}) — a distância real já garante isso`, { p1, p3 });
}

console.log('\nCOMPATIBILIDADE: relatório sem nível 3 (maioria dos casos) continua idêntico');
{
  const nivel1 = [venda(6000, 0.1), venda(6200, 0.15)];
  const nivel2 = [venda(5800, 0.6)];
  const semNivel3 = avaliarMercado({ nivel1, nivel2 });          // nivel3 nem é passado
  const comNivel3Vazio = avaliarMercado({ nivel1, nivel2, nivel3: [] });
  ok(semNivel3.consolidado.n === 3, 'sem nivel3 no argumento, resultado não muda (n=3)', semNivel3.consolidado.n);
  ok(semNivel3.consolidado.precoMedioM2 === comNivel3Vazio.consolidado.precoMedioM2,
    'passar nivel3:[] dá o MESMO resultado de omitir — nenhuma análise antiga muda de valor');
  ok(!!semNivel3.nivel3, 'a chave nivel3 aparece mesmo vazia (n=0), sem crash em quem a lê depois');
}

console.log('\nNÍVEL 3 ENTRA NO MESMO FILTRO DE OUTLIER DO CONJUNTO (não por balde isolado)');
{
  // 4 amostras "normais" (~5000/m²) + 1 outlier extremo no nível 3 (fora de [mediana/2,5; mediana×2,5]).
  const r = avaliarMercado({
    nivel1: [venda(5000, 0.1), venda(5100, 0.15)],
    nivel2: [venda(4900, 0.6), venda(5050, 0.8)],
    nivel3: [venda(50000, 1.5)], // 10x a mediana — deve ser descartado como outlier
  });
  ok(r.consolidado.n === 4, 'o outlier do nível 3 é descartado do consolidado (fica em 4, não 5)', r.consolidado.n);
  ok(r.descartadas.some(d => d._motivo === 'outlier'), 'o descarte é rastreado com o motivo outlier');
}

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${falhas === 0 ? 'todos os casos passaram' : `${falhas} falha(s)`}\n`);
process.exit(falhas ? 1 : 0);
