// Classe Brooklin (15/11, arena): condição sem prova nunca abre o cenário financiado; FGTS não é parcelamento.
import assert from 'node:assert/strict';
import { extrairPagamentoTexto } from '../../api/_doc-extracao.js';
import { montarCondicoesPagamento } from '../../api/_condicoes-origem.js';
import { aplicarCondicoesEdital, pagamentoNaoConfirmado } from '../../src/lib/condicoes-pagamento.js';
import { fraseCondicoesPagamento } from '../../src/lib/nota-metodologica.js';

// 1. BROOKLIN (MEGA X131536): à vista, FGTS vedado. Antes: fgts:true → financiado com 5%/360.
const tBrooklin = 'O proponente vencedor terá prazo de 24 horas para efetuar o pagamento do valor total da arrematação, à vista. Não é permitida a utilização do FGTS nem financiamento.';
const rB = extrairPagamentoTexto(tBrooklin);
assert.notEqual(rB.fgts, true, 'FGTS negado não vira true');
const cB = montarCondicoesPagamento({ edital: { regras: rB, texto: tBrooklin }, modalidade: 'extrajudicial' });
assert.equal(cB.cenarioInicial, 'aVista');
assert.equal(cB.campos.aVista?.origem, 'edital_texto');
assert.equal(cB.campos.sinalPct, undefined, 'nenhum sinal inventado');

// 2. Mesmo com um fgts:true VELHO (cache de antes do conserto), FGTS sozinho não abre financiado.
const cVelho = montarCondicoesPagamento({ edital: { regras: { aVista: true, fgts: true, comissaoPct: 5 }, texto: tBrooklin } });
assert.equal(cVelho.cenarioInicial, 'aVista');
assert.equal(cVelho.campos.fgts.origem, 'edital_sem_trecho', 'o trecho não sustenta o fgts:true velho');

// 3. "Aceita FGTS" sem parcelas: à vista.
const tFgts = 'Pagamento à vista. Aceita utilização do FGTS conforme regras do agente financeiro.';
assert.equal(montarCondicoesPagamento({ edital: { regras: extrairPagamentoTexto(tFgts), texto: tFgts } }).cenarioInicial, 'aVista');

// 4. Art. 895: 25% + 30 parcelas lido e citado no edital judicial → financiado, tipo parcelado_judicial.
const t895 = 'Pagamento à vista ou parcelado: sinal de 25% e saldo em até 30 parcelas mensais corrigidas pelo IPCA.';
const c895 = montarCondicoesPagamento({ edital: { regras: extrairPagamentoTexto(t895), texto: t895 }, modalidade: 'judicial' });
assert.equal(c895.cenarioInicial, 'financiado'); assert.equal(c895.tipoParcelamento, 'parcelado_judicial');
assert.equal(c895.campos.parcelas.origem, 'edital_texto'); assert.equal(c895.campos.sinalPct.valor, 25);

// 5. Título "financiável 240x" contra edital à vista: o título NÃO abre financiado; aparece como anúncio.
const tTit = 'Apartamento — Entrada de 30% + Saldo em 240x';
const cTit = montarCondicoesPagamento({ edital: { regras: rB, texto: tBrooklin }, anuncio: { regras: extrairPagamentoTexto(tTit), texto: tTit } });
assert.equal(cTit.cenarioInicial, 'aVista');
assert.equal(cTit.campos.parcelas?.origem, 'anuncio');

// 6. Só padrão do leiloeiro / só documental (IA): nunca abrem financiado.
assert.equal(montarCondicoesPagamento({ prior: { regras: { parcelamentoPermitido: true, parcelas: 30 }, amostras: 4 } }).cenarioInicial, 'aVista');
assert.equal(montarCondicoesPagamento({ documental: { regras: { parcelas: 10, sinalPct: 25 }, texto: 'sinal 25% e 10 parcelas' } }).cenarioInicial, 'aVista');

// 7. Ficha da Caixa com financiamento=true → financiado (dado estruturado do vendedor).
assert.equal(montarCondicoesPagamento({ fichaCef: { financiamento: true, fgts: true } }).cenarioInicial, 'financiado');
assert.equal(montarCondicoesPagamento({ fichaCef: { financiamento: false, fgts: true } }).cenarioInicial, 'aVista');

// 8. Nada lido: à vista, com motivo dizendo isso.
const nada = montarCondicoesPagamento({});
assert.equal(nada.cenarioInicial, 'aVista'); assert.match(nada.motivo, /não lidas/);
// 9. Regra do ANÚNCIO aplicada na projeção não sai como "edital": vira premissa e acende o aviso do cartão.
const dVazio = { sinalPercentual: 5, prazoMeses: 360, origemCondicoesPagamento: '' };
const pcA = aplicarCondicoesEdital(dVazio, { parcelas: 240, sinalPct: 30, parcelamentoPermitido: true }, '', { regrasOrigem: 'anuncio' });
assert.equal(pcA.origemCondicoesPagamento, 'premissa_anuncio');
assert.equal(pagamentoNaoConfirmado({ ...dVazio, ...pcA }, false), true);
assert.match(fraseCondicoesPagamento({ ...pcA, origem: pcA.origemCondicoesPagamento }), /NÃO confirmadas no edital.*anúncio/);
// Do edital mesmo, continua 'edital'.
assert.equal(aplicarCondicoesEdital(dVazio, { parcelas: 10, sinalPct: 25 }, '').origemCondicoesPagamento, 'edital');
console.log('condicoes-origem: ok');
