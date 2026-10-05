// #44 (05/10): FRAZÃO — página real tinha "Liberado para Lance" e o 2º leilão por vir; o lote era
// apurado como "indeterminado" 3 vezes e abandonado. Trechos do HTML real.
import assert from 'node:assert/strict';
import { apurarResultadoDoTexto } from '../../api/_resultado-leilao.js';
const URL = 'https://www.frazaoleiloes.com.br/lote/42005-apartamento-no-outeiro-de-passargada-cotia-sp';
const pag = (status, lance = '0,00') => `<div id="content_auction_ended" class="modal-body">Prezado usuário, esses lote pertence a um leilão que já foi encerrado.</div>
<div class="pull-left label-grey"><span>Maior lance atual:</span> <br /> <span id="value_bid"><b> R$ ${lance} </b></span></div>
<div class="alert label-grey auction-status" role="alert">\r\n ${status}\r\n </div>
<h4 class="label-grey">1&#186; Leil&#227;o: 02/10/2026 </h4><h4>2&#186; Leil&#227;o: 30/12/2099  &#224;s 15h00 </h4>`;
const aberto = apurarResultadoDoTexto(pag('Liberado para Lance'), URL);
assert.equal(aberto.aberto, true);
assert.equal(aberto.novaData.data_leilao_2, '2099-12-30T15:00:00-03:00');
assert.deepEqual(apurarResultadoDoTexto(pag('Encerrado'), URL), { resultado: 'sem_lance', valor: null });
assert.deepEqual(apurarResultadoDoTexto(pag('Encerrado', '250.000,00'), URL), { resultado: 'vendido', valor: 250000 });
assert.deepEqual(apurarResultadoDoTexto(pag('Vendido', '180.500,00'), URL), { resultado: 'vendido', valor: 180500 });
console.log('ok — frazão: aberto, sem lance, vendido');
