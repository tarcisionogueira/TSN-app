// Condições de pagamento escritas pelo documental chegam à projeção (16/10, lote judicial TJSP em Santana de
// Parnaíba): número por extenso ("duas parcelas") e percentual antes da palavra ("50% de sinal").
import assert from 'node:assert/strict';
import { extrairPagamentoTexto } from '../../api/_doc-extracao.js';

const a = extrairPagamentoTexto('À vista (guia de depósito judicial em 24h) ou parcelado: 50% de sinal em 24h + 2 parcelas de 25% nos meses subsequentes, corrigidas pela Tabela Prática TJSP.');
assert.equal(a.sinalPct, 50); assert.equal(a.parcelas, 2);
const b = extrairPagamentoTexto('À vista (guia de depósito judicial no dia útil seguinte) ou parcelado: sinal mínimo de 50% em 24h + duas parcelas de 25% nos meses subsequentes.');
assert.equal(b.sinalPct, 50); assert.equal(b.parcelas, 2);
const c = extrairPagamentoTexto('Pagamento à vista, não é permitido o parcelamento do valor da arrematação conforme edital.');
assert.equal(c.parcelas, null); assert.equal(c.parcelamentoPermitido, null);
console.log('ok pagamento do documental');
