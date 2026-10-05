// #98 (05/10): veículo LJUD gravava data_leilao=null FIXO (1.887 sem data, nunca apurados nem
// desligados). Trecho REAL de página de veículo LJUD: a data é a do último encerramento.
import assert from 'node:assert/strict';
import { datasLjud } from '../../api/enriquecer-lote.js';
const t = 'Aberto para Lances Categoria(s) do leilao: Bens Diversos Imóveis Veículos 66 38 8753 Condições de venda 38 lote(s) em RS 1º Encerramento - 05/10/2099 11:00 2º Encerramento - 19/10/2099 11:00 voltar para o leilão Compartilhar CITROEN/PICASSO PRETO 2010/2011';
assert.equal(datasLjud(t).encerramento, new Date('2099-10-19T11:00:00-03:00').toISOString());
assert.equal(datasLjud('Lote sem rótulo de encerramento'), null);
console.log('ok — veículo LJUD: data do último encerramento');
