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
// 10. TEXTOS REAIS (medição em seco de 15/11 nos relatórios dos últimos 45 dias): parcelável de verdade não pode virar
// veto. Antes do conserto, os três primeiros saíam "parcelamento vedado" e travavam o cenário parcelado.
const reais = [
  ['judicial', 'PAGAMENTO DE FORMA À VISTA: A arrematação far-se-á mediante pagamento à vista do preço pelo arrematante através de guia de depósito judicial, no prazo de 24 horas. PAGAMENTO DE FORMA PARCELADA: O pagamento poderá ser parcelado em primeiro leilão por valor não inferior ao da avaliação, conforme art. 895, I e II, do CPC: I – O arrematante deverá pagar 25% do valor do lance à vista e o restante parcelado em até 30 (trinta) meses', 'financiado', { parcelas: 30, sinalPct: 25 }],
  ['judicial', 'As propostas de arrematação parcelada deverão ser enviadas por escrito ao leiloeiro antes do leilão. Caso haja lance à vista na plataforma, todas as propostas para pagamento parcelado serão desconsideradas (art. 895, §7º, CPC).', 'financiado', {}],
  ['extrajudicial', 'FORMAS DE PAGAMENTO: Imóveis OCUPADOS poderão ser pagos à vista ou financiado diretamente com o vendedor. Imóveis DESOCUPADOS poderão ser pagos à vista ou com financiamento junto a qualquer agente financeiro. O uso do FGTS é possível.', 'financiado', { financiavel: true }],
  ['extrajudicial', 'O PAGAMENTO DEVERÁ SER FEITO À VISTA acrescido da COMISSÃO DE 5% (CINCO POR CENTO) DO LEILOEIRO, AMBOS DEPOSITADOS EM CONTA CORRENTE DO LEILOEIRO em até 48 horas após o leilão.', 'aVista', { parcelamentoPermitido: false }],
  ['judicial', 'Sobre a parte do(a) coproprietário(a) não se aplica parcelamento. Em caso de imóveis, o pagamento poderá ser parcelado em primeiro leilão.', 'financiado', {}],
];
for (const [mod, t, cen, esperado] of reais) {
  const rr = extrairPagamentoTexto(t);
  for (const [k, v] of Object.entries(esperado)) assert.equal(rr[k], v, `${k} em: ${t.slice(0, 60)}`);
  assert.equal(montarCondicoesPagamento({ edital: { regras: rr, texto: t }, modalidade: mod }).cenarioInicial, cen, t.slice(0, 60));
}
assert.notEqual(extrairPagamentoTexto('Pagamento à vista. Não será aceito pagamento parcelado ou financiado.').financiavel, true, 'negação de financiado');
console.log('condicoes-origem: ok');

// 11. SELO DO SISTEMA DE LANCES (17/11, REGIONALLEIL 902 — Porto Alegre). Judicial sem edital lido + "ACEITA LANCE
// PARCELADO" na página → abre parcelado (art. 895). Fora do judicial, o selo não traz número: fica à vista.
const selo = { parcelamentoPermitido: true, selo: 'ACEITA LANCE PARCELADO', tipo: 'lance', fonte: 'leilaopro' };
const cSeloJ = montarCondicoesPagamento({ plataforma: selo, modalidade: 'judicial' });
assert.equal(cSeloJ.cenarioInicial, 'financiado');
assert.equal(cSeloJ.tipoParcelamento, 'parcelado_judicial');
assert.equal(cSeloJ.campos.parcelamentoPermitido.origem, 'plataforma_leiloeiro');
assert.match(cSeloJ.motivo, /art\. 895/);
const cSeloX = montarCondicoesPagamento({ plataforma: { ...selo, selo: 'ACEITA PROPOSTA PARCELADA', tipo: 'proposta' }, modalidade: 'extrajudicial' });
assert.equal(cSeloX.cenarioInicial, 'aVista', 'extrajudicial: selo sem números não abre o 5%/360 bancário');
assert.equal(cSeloX.campos.parcelamentoPermitido.origem, 'plataforma_proposta');
// Edital que VEDA, citado, manda sobre o selo.
const tVeda = 'O pagamento será exclusivamente à vista, não sendo admitido parcelamento.';
const rVeda = extrairPagamentoTexto(tVeda);
if (rVeda.parcelamentoPermitido === false) {
  assert.equal(montarCondicoesPagamento({ edital: { regras: rVeda, texto: tVeda }, plataforma: selo, modalidade: 'judicial' }).cenarioInicial, 'aVista');
}
assert.equal(montarCondicoesPagamento({ plataforma: null, modalidade: 'judicial' }).cenarioInicial, 'aVista');
console.log('ok — selo do sistema de lances');
