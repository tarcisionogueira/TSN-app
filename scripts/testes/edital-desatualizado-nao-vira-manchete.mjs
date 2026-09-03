/**
 * npm run testar:edital-desatualizado — o edital de outra base não vira número no relatório.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Achado do dono (03/09, regerando o relatório de um apartamento em Guarulhos/SP — MEGA
 * J126875): a ficha mostrava "Lance mínimo R$ 159.590,70" no topo, e o corpo do relatório
 * ("Condições lidas no edital" + o parecer da IA) citava "1ª praça R$ 228.333,00 · 2ª praça
 * R$ 137.000,00" — três números, nenhum conciliado com os outros dois.
 *
 * CAUSA: o PDF do edital (16/07) avaliava o imóvel em R$ 228.333,33; a Caixa/leiloeiro já
 * republicou com a avaliação atualizada pela tabela do TJ (R$ 265.984,50 → 2ª praça real
 * R$ 159.590,70). Já existia uma trava (`editalValoresBatem`, 28/08 + reforçada 02/09) que
 * IMPEDIA gravar esse valor errado na coluna `valor_minimo_2` — mas ela só protegia o BANCO.
 * `mercado.condicoesEdital.pracas` — o que o relatório mostra e o que o prompt do parecer da
 * IA recebe rotulado como "fonte de verdade" — seguia recebendo os valores incoerentes sem
 * filtro nenhum. A mesma trava agora tem que valer nos DOIS destinos.
 *
 * Este teste cobre a função PURA (`editalValoresBatem`) com o caso real, e a MÁSCARA que
 * `api/gerar-analise.js` aplica sobre `pracas`/`avaliacao` antes de gravar em
 * `mercado.condicoesEdital` (replicada aqui porque a lógica de mascaramento vive inline no
 * handler, não extraída — testar a função pura + a fórmula da máscara cobre o comportamento
 * real sem precisar simular toda a geração de análise, que depende de IA/rede/banco).
 *
 * PARTE 2 (mesmo dia, pedido do dono ao ver o resultado: "se fazemos scraper do leiloeiro,
 * temos mais fontes pra cruzar as informações" em vez de só descartar o valor do PDF velho).
 * `derivarPracasDoAnuncio` cruza com o que o ANÚNCIO ATUAL já confirma: praça 1 = avaliação
 * atual (art. 891 CPC), praça 2 = lance mínimo atual do site. Validado (medido, não suposto)
 * contra 5 lotes judiciais reais da MEGA em 03/09: em todos, valor_minimo/valor_avaliacao
 * ATUAIS batem — com precisão de centavo — na MESMA razão que o edital velho tinha entre suas
 * duas praças (50% ou 60%, sempre redondo). O contra-exemplo (Itapema, extrajudicial, razão
 * 25%) prova que o escopo tem que ficar travado em `modalidade === 'judicial'`.
 */
import { editalValoresBatem, derivarPracasDoAnuncio } from '../../api/gerar-analise.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

// Espelha a máscara de api/gerar-analise.js (mercado.condicoesEdital): quando os valores não
// batem, `pracas[].valor` vira null (a data continua) e `avaliacao` vira null.
function mascarar({ avalDb, extratoAvaliacao, pracas, aEd }) {
  const p1 = (pracas || []).find(p => p.n === 1);
  const batem = editalValoresBatem({ avalDb, extratoAvaliacao, p1Valor: p1?.valor });
  return {
    pracas: batem ? pracas : (pracas || []).map(p => ({ ...p, valor: null })),
    avaliacao: batem ? (aEd || null) : null,
    valoresDesatualizados: !batem,
  };
}

console.log('\nO CASO REAL — MEGA J126875, Guarulhos/SP (03/09)');
checa('avaliação do edital (228.333,33) diverge >2% da avaliação atual do anúncio (265.984,50) — não batem',
  editalValoresBatem({ avalDb: 265984.50, extratoAvaliacao: 228333.33, p1Valor: 228333.33 }) === false);

const pracasReais = [
  { n: 1, data: '2026-08-17', fim: '2026-08-20', valor: 228333.33 },
  { n: 2, data: '2026-08-20', fim: '2026-09-10', valor: 136999.998 },
];
const resultado = mascarar({ avalDb: 265984.50, extratoAvaliacao: 228333.33, pracas: pracasReais, aEd: 228333.33 });
checa('1ª praça perde o valor (mas mantém a data)',
  resultado.pracas[0].valor === null && resultado.pracas[0].data === '2026-08-17');
checa('2ª praça perde o valor (mas mantém a data)',
  resultado.pracas[1].valor === null && resultado.pracas[1].data === '2026-08-20');
checa('avaliação do edital some do relatório (não vira "Avaliação no edital: R$ 228.333")',
  resultado.avaliacao === null);
checa('a bandeira `valoresDesatualizados` fica marcada — é o que troca o texto do prompt/tela',
  resultado.valoresDesatualizados === true);

console.log('\nEDITAL COERENTE (a maioria dos lotes) NÃO PODE SER PENALIZADO — mesma avaliação, dentro de 2%');
checa('avaliação do edital bate com a do anúncio (mesmo valor) — batem',
  editalValoresBatem({ avalDb: 300000, extratoAvaliacao: 300000, p1Valor: 300000 }) === true);
checa('divergência pequena (1,5%, arredondamento/captura) ainda é tolerada — batem',
  editalValoresBatem({ avalDb: 300000, extratoAvaliacao: 304500, p1Valor: 304500 }) === true);
const resultadoOk = mascarar({ avalDb: 600000, extratoAvaliacao: 600000, pracas: [{ n: 1, data: '2026-08-10', valor: 600000 }, { n: 2, data: '2026-08-13', valor: 300000 }], aEd: 600000 });
checa('edital coerente: os valores REAIS continuam no relatório (não é uma máscara permanente)',
  resultadoOk.pracas[0].valor === 600000 && resultadoOk.pracas[1].valor === 300000 && resultadoOk.avaliacao === 600000 && resultadoOk.valoresDesatualizados === false);

console.log('\nSEM AVALIAÇÃO PARA COMPARAR — não pode travar por falta de dado (regra "não sabe" ≠ "está errado")');
checa('sem avaliação atual do anúncio (avalDb=0) — nada para comparar, passa (batem)',
  editalValoresBatem({ avalDb: 0, extratoAvaliacao: 228333.33, p1Valor: 228333.33 }) === true);
checa('sem nenhuma referência do edital (nem avaliação nem 1ª praça) — nada para comparar, passa (batem)',
  editalValoresBatem({ avalDb: 265984.50, extratoAvaliacao: null, p1Valor: null }) === true);

console.log('\nDERIVAR DO ANÚNCIO ATUAL — 5 lotes judiciais REAIS da MEGA (medidos em 03/09)');
const P1 = { data: '2026-08-17', fim: '2026-08-20' };
const P2 = { data: '2026-08-20', fim: '2026-09-10' };
const casosReais = [
  // [titulo, avalDb (scraped atual), valorMinimo (scraped atual), razão esperada]
  ['Guarulhos/SP — J126875',      265984.50, 159590.70, 0.60],
  ['Vila Olímpia/SP',             614649.94, 307324.97, 0.50],
  ['Itaim Bibi/SP',               837297.66, 418648.84, 0.50],
  ['Santa Cecília/SP',            293964.86, 176378.91, 0.60],
  ['Vila Andrade/SP',            1287073.40, 772244.03, 0.60],
];
for (const [titulo, avalDb, valorMinimo, razao] of casosReais) {
  const d = derivarPracasDoAnuncio({ modalidade: 'judicial', avalDb, valorMinimo, valorMinimo2: null, p1: P1, p2: P2 });
  checa(`${titulo}: praça 1 = avaliação atual (R$ ${avalDb})`,
    d[0].valor === avalDb && d[0].estimado === 'avaliacao_atual' && d[0].data === P1.data);
  checa(`${titulo}: praça 2 = lance mínimo atual (R$ ${valorMinimo}, razão ${razao * 100}% da avaliação)`,
    d[1].valor === valorMinimo && d[1].estimado === 'anuncio_atual' && Math.abs(valorMinimo / avalDb - razao) < 0.001);
}

console.log('\nESCOPO ESTREITO — não pode vazar para fora do que foi validado');
checa('extrajudicial NÃO deriva (Itapema, 19/08: razão real é 25%, não 50/60% — inventaria número errado)',
  derivarPracasDoAnuncio({ modalidade: 'extrajudicial', avalDb: 1102059.26, valorMinimo: 278814.15, valorMinimo2: null, p1: P1, p2: P2 }) === null);
checa('sem avaliação atual confirmada (avalDb=0) — não deriva, nada para cruzar',
  derivarPracasDoAnuncio({ modalidade: 'judicial', avalDb: 0, valorMinimo: 159590.70, valorMinimo2: null, p1: P1, p2: P2 }) === null);
checa('edital com praça única (sem p2) — não inventa uma 2ª praça que o documento nunca mostrou',
  derivarPracasDoAnuncio({ modalidade: 'judicial', avalDb: 265984.50, valorMinimo: 159590.70, valorMinimo2: null, p1: P1, p2: null }) === null);
checa('ainda na janela da 1ª praça (lance mínimo atual == avaliação, 2ª praça ainda não tem valor próprio) — praça 2 fica sem valor, não inventa',
  derivarPracasDoAnuncio({ modalidade: 'judicial', avalDb: 265984.50, valorMinimo: 265984.50, valorMinimo2: null, p1: P1, p2: P2 })[1].valor === null);
checa('valor_minimo_2 já populado (o card do leiloeiro emparelhou as 2 praças) — usa ele direto, sem estimar',
  derivarPracasDoAnuncio({ modalidade: 'judicial', avalDb: 600000, valorMinimo: 400000, valorMinimo2: 300000, p1: P1, p2: P2 })[1].valor === 300000);

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 25) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
