// 15/11 — edital MEGA X131536 (Brooklin, alienação fiduciária, Lei 9.514): o preço TODO em 24 h, à vista; FGTS
// proibido. O extrator lia `fgts: true` (bastava a palavra), não via o "à vista" e devolvia `null` para o parcelamento
// — e o relatório projetou 5% de sinal + parcela de banco. Trechos LITERAIS do edital.
import assert from 'node:assert/strict';
import { extrairPagamentoTexto } from '../../api/_doc-extracao.js';
import { condicoesDoEdital } from '../../src/lib/condicoes-pagamento.js';

const edital = 'O proponente vencedor por meio de lance on-line ou presencial terá prazo de 24 horas depois de comunicado expressamente pelo leiloeiro acerca da efetiva arrematação do imóvel, para efetuar o pagamento, por meio de transferência bancária, da totalidade do preço e da comissão do leiloeiro, conforme edital. '
  + '2.1. No prazo de até 24h da comunicação pelo leiloeiro acerca da efetivação da arrematação, o COMPRADOR pagará ao VENDEDOR, a importância equivalente ao valor total da arrematação e/ou do exercício do direito de preferência, diretamente de conta bancária de titularidade do COMPRADOR para conta bancária de titularidade do VENDEDOR, à vista, através de transferência, DOC’s ou TED’s. '
  + '2.1.2. O valor referente a comissão do leiloeiro, correspondente a 5% (cinco por cento) do valor da arrematação, deverá ser pago diretamente ao leiloeiro. '
  + '2.2. Não é permitida a utilização do FGTS, nem de cartas de crédito para adquirir imóveis no leilão. '
  + '4. CONDIÇÕES ESPECIAIS PARA VENDA DE IMÓVEIS RURAIS (Não temos financiamento). '
  + '3.16.1. o VENDEDOR devolverá ao COMPRADOR: (i) o valor relativo ao sinal e parcelas do preço pagos pelo imóvel até a data da restituição';
const p = extrairPagamentoTexto(edital);
assert.equal(p.aVista, true, 'valor total / à vista');
assert.equal(p.fgts, false, '"Não é permitida a utilização do FGTS" é PROIBIÇÃO');
assert.equal(p.financiavel, false, '"Não temos financiamento"');
assert.equal(p.sinalPct, null, '"sinal e parcelas do preço" na cláusula de evicção não é sinal de pagamento');
assert.equal(p.comissaoPct, 5);
assert.equal(p.parcelamentoPermitido, false, 'à vista sem prova de parcelamento → vedado');
const ce = condicoesDoEdital(p, '');
assert.equal(ce?.veda, true, 'a projeção recebe o veto (somenteAVista)');

// O que NÃO pode mudar: edital que oferece as duas formas continua parcelável; FGTS afirmado continua true.
const duas = extrairPagamentoTexto('Pagamento à vista ou parcelado: sinal de 25% e saldo em até 30 parcelas mensais. Aceita-se FGTS conforme regras da CEF.');
assert.notEqual(duas.parcelamentoPermitido, false); assert.equal(duas.parcelas, 30); assert.equal(duas.sinalPct, 25); assert.equal(duas.fgts, true);
assert.equal(condicoesDoEdital(duas, '').permite, true, 'continua parcelável na projeção');
const cef = extrairPagamentoTexto('Imóvel aceita financiamento habitacional e utilização do FGTS. Pagamento à vista ou financiado pela CAIXA.');
assert.equal(cef.financiavel, true); assert.equal(cef.fgts, true); assert.notEqual(cef.parcelamentoPermitido, false);
console.log('edital-a-vista-sem-fgts: ok');
