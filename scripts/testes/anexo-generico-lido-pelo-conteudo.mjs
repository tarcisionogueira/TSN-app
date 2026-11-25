// 24/11 — apto 601 da Rua André Puente (Porto Alegre), DLD Leiloeiro, TRT4 0020805-91.2026.5.04.0012.
// O edital estava publicado como botões "Download" (/media/download/1524, sem extensão, `attachment`) e
// "Visualizar"; o scraper gravou `tipo:'anexo'` e nenhum leitor considerava esse tipo. O relatório saiu
// "à vista, sem parcela" e sem metragem, com o edital oferecendo 25% de entrada + 30 parcelas SELIC.
// Este teste roda sem rede: trechos LITERAIS do edital + uma matrícula sintética no formato registral.
import assert from 'node:assert/strict';
import { tipoDocPorTexto, todosOsAnexos } from '../../api/_edital-extrato.js';
import { extrairPagamentoTexto } from '../../api/_doc-extracao.js';
import { condicoesDoEdital } from '../../src/lib/condicoes-pagamento.js';

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log(`  ✓ ${nome}`); };

const clausula = 'g) Condições da proposta As propostas poderão ser feitas à vista ou a prazo. As propostas a prazo somente serão válidas com a oferta de entrada de, no mínimo, 25% (vinte e cinco por cento) do valor da proposta e de saldo em, no máximo, 30 (trinta) parcelas mensais, corrigidas pela variação positiva da SELIC, conforme previsto no art. 63, § 4º, do Provimento Conjunto GP.GCR nº 05/2025 do TRT da 4ª Região.';
const edital = 'PODER JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL DO TRABALHO DA 4ª REGIÃO 12ª VARA DO TRABALHO DE PORTO ALEGRE '
  + 'EDITAL DE VENDA DIRETA. JUÍZO AUXILIAR DA EXECUÇÃO DIVISÃO DE HASTAS PÚBLICAS E ALIENAÇÕES POR INICIATIVA PARTICULAR. '
  + 'O leiloeiro oficial torna público que fará realizar a alienação por iniciativa particular do bem abaixo, objeto da matrícula nº 104.938 do Registro de Imóveis da 4ª Zona. '
  + 'Descrição do bem: apartamento nº 601 do Edifício, com área privativa de 128,94 m², e box de estacionamento. '
  + 'Do edital constam as regras do leilão, a comissão do leiloeiro de 5% e o lance mínimo para a venda direta. '
  + clausula + ' Quando houver concorrência entre propostas à vista de igual valor, será vencedora a apresentada em primeiro lugar. '
  + 'Os interessados deverão observar as condições deste edital, que será publicado na forma da lei. Porto Alegre, data da assinatura eletrônica.';
const matricula = 'REGISTRO DE IMÓVEIS DA 4ª ZONA DE PORTO ALEGRE LIVRO Nº 2 - REGISTRO GERAL MATRÍCULA 104.938 FICHA 01 '
  + 'IMÓVEL: Apartamento nº 601 do Edifício situado na Rua André Puente, nº 120, com área real privativa de 128,94 m², área real de uso comum de 30,10 m², '
  + 'área real total de 159,04 m², correspondendo-lhe a fração ideal de 0,0833 no terreno e nas coisas de uso comum, confrontando ao norte com o imóvel vizinho. '
  + 'PROPRIETÁRIA: conforme registro anterior. R-1/104.938 - Compra e venda. Transmitente e adquirente qualificados no título, pelo preço declarado. '
  + 'AV-2/104.938 - Penhora determinada nos autos do processo trabalhista, conforme ofício do juízo. O Oficial Registrador. '
  + 'R-3/104.938 - Hipoteca em favor do credor, conforme escritura pública lavrada em tabelionato. O Oficial Registrador substituto.';

console.log('\nO CONTEÚDO DIZ O QUE É O ANEXO');
caso('edital do TRT4 é reconhecido como edital (mesmo citando o nº da matrícula)', () => assert.equal(tipoDocPorTexto(edital), 'edital'));
caso('matrícula no formato registral é reconhecida como matrícula', () => assert.equal(tipoDocPorTexto(matricula), 'matricula'));
caso('texto curto/escaneado não é afirmado como nada', () => assert.equal(tipoDocPorTexto('MATRÍCULA 104938'), null));

console.log('\nTODOS OS ANEXOS ENTRAM, QUALQUER NOME (regra do dono, 24/11); FOTO NÃO É DOCUMENTO');
caso('download sem extensão, "Visualizar", laudo, edital rotulado — todos; foto e lixo não; os já tentados não repetem', () => {
  const r = todosOsAnexos([
    { url: 'https://www.dldleiloeiro.com.br/media/download/1524', nome: 'Download', tipo: 'anexo' },
    { url: 'https://x.com/doc.pdf', nome: 'Visualizar' },
    { url: 'https://x.com/auto.pdf', nome: 'Auto de avaliação', tipo: 'laudo' },
    { url: 'https://x.com/edital.pdf', tipo: 'edital' },
    { url: 'https://x.com/foto.jpg', tipo: 'anexo' },
    { url: 'javascript:void(0)', tipo: 'anexo' },
    'https://x.com/solto.pdf',
  ], { exceto: ['https://x.com/edital.pdf'] });
  assert.deepEqual(r, ['https://www.dldleiloeiro.com.br/media/download/1524', 'https://x.com/doc.pdf', 'https://x.com/auto.pdf', 'https://x.com/solto.pdf']);
});

console.log('\nA CLÁUSULA DE PAGAMENTO DO TRT4');
caso('"entrada de, no mínimo, 25%" + "saldo em, no máximo, 30 (trinta) parcelas" + "à vista ou a prazo"', () => {
  const p = extrairPagamentoTexto(clausula);
  assert.equal(p.sinalPct, 25);
  assert.equal(p.parcelas, 30);
  assert.equal(p.parcelamentoPermitido, true);
  const ce = condicoesDoEdital(p, clausula);
  assert.equal(ce.permite, true);
  assert.equal(ce.veda, false);
});
caso('edital judicial com IGPM: "pelo menos 25% do valor do lance à vista e o restante em até 30 meses", comissão 10%', () => {
  const p = extrairPagamentoTexto('Pagamentos: Pagamento integral do lance por meio de Guia de Depósito Judicial (Art. 892 do Código de Processo Civil). Comissão do leiloeiro de 10% sobre o valor de arrematação do imóvel, paga juntamente com o valor da arrematação ou a entrada de 25% no caso de parcelamento. Parcelamento: Possibilidade de proposta de aquisição parcelada, com oferta de pelo menos 25% do valor do lance à vista e o restante em até 30 meses, garantido por caução idônea ou hipoteca do próprio bem imóvel. O reajuste do parcelamento, quando não fixado pelo Magistrado, será feito pelo IGPM/FGV.');
  assert.equal(p.sinalPct, 25);
  assert.equal(p.parcelas, 30);
  assert.equal(p.comissaoPct, 10);
  assert.equal(p.parcelamentoPermitido, true);
});
caso('"25% (vinte e cinco por cento) do valor do lance à vista e o restante parcelado em até 30 (trinta) meses"', () => {
  const p = extrairPagamentoTexto('§1º A proposta conterá, em qualquer hipótese, oferta de pagamento de pelo menos 25% (vinte e cinco por cento) do valor do lance à vista e o restante parcelado em até 30 (trinta) meses, garantido por caução idônea.');
  assert.equal(p.sinalPct, 25);
  assert.equal(p.parcelas, 30);
});
caso('"não serão aceitas propostas a prazo" continua vetando', () => {
  const p = extrairPagamentoTexto('O pagamento da arrematação será à vista. Não serão aceitas propostas a prazo.');
  assert.equal(p.parcelamentoPermitido, false);
});
caso('"30 (trinta) metros de frente" não vira parcela', () => {
  const p = extrairPagamentoTexto('Terreno com 30 (trinta) metros de frente. Pagamento à vista do valor total da arrematação.');
  assert.equal(p.parcelas, null);
});

console.log(`\n✓ anexo-generico-lido-pelo-conteudo: ${ok} casos`);
