// #44 (05/10): VIP — trechos REAIS de duas páginas (aberta pelo GitHub com cookie). O genérico dava
// "vendido R$ 5.000" (o Incremento) para um lote vendido por R$ 109.340,02.
import assert from 'node:assert/strict';
import { apurarResultadoDoTexto } from '../../api/_resultado-leilao.js';
const U = 'https://www.leilaovip.com.br/evento/anuncio/casa-com-8937-m-centro-02-22529';
const vendido = 'Leil&#xE3;o Encerrado LOTE 6: Casa com 89,37 m² - Centro TABAPUÃ SP Vendido Leilão ao vivo Finalizando Em: 0 seg Atual : 109.340,02 Por: A***0 (Direito de Preferência) Vendido Vendido por Compre Já DÊ UM LANCE À VISTA R$ 114.340,02 Incremento: R$ 5.000,00 Status: Vendido Tipo de Leil&#xE3;o: Extrajudicial Código: 1256622 O leil&#xE3;o está encerrado';
const semOferta = 'Leil&#xE3;o Encerrado LOTE 2: Apartamento Sem ofertas Inicial : 713.000,00 Por: (Direito de Preferência) Sem ofertas Vendido por Compre Já R$ 713.000,00 R$ 733.000,00 Incremento: R$ 20.000,00 Status: Sem ofertas Tipo de Leil&#xE3;o: Extrajudicial O leil&#xE3;o está encerrado';
const aberto = 'LOTE 3: Casa Aguarde o início do Leilão Inicial : 300.000,00 Vendido por Compre Já Incremento: R$ 5.000,00 Status: Aberto Tipo de Leilão: Extrajudicial';
assert.deepEqual(apurarResultadoDoTexto(vendido, U), { resultado: 'vendido', valor: 109340.02 });
assert.deepEqual(apurarResultadoDoTexto(semOferta, U), { resultado: 'sem_lance', valor: null });
assert.equal(apurarResultadoDoTexto(aberto, U).aberto, true);
console.log('ok — vip: vendido com o valor do painel, sem ofertas, aberto');
