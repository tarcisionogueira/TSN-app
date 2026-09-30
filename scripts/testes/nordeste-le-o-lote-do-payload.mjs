// NORDESTE: o lote vem do objeto do payload RSC, não do slug nem do texto solto (30/09).
// Caso real: "50% do apartamento… Salvador" saía sem o 50%, avaliação 190 mil (quota-parte citada no
// texto) contra lance 300 mil, área 0 e só a 1ª praça. O texto solto da página traz OUTROS lotes.
import assert from 'node:assert/strict';
import { parseDetalhe, montarRow, TENANTS } from '../lib/nordeste-parse.mjs';

const slug = '196-001-50-do-apartamento-localizado-no-edif-residencial-ilha-de-capri-imbui-salvadorba';
const esc = (o) => JSON.stringify(o).replace(/"/g, '\\"');
const auction = { squares: [
  { type: { square: 2 }, closing: '2026-09-28T13:00:00.000Z', hidden: false },
  { type: { square: 1 }, closing: '2026-09-21T13:00:00.000Z', hidden: false },
] };
const resumo = { id: 'a', slug, title: '50% do Apartamento localizado no Edif. Residencial Ilha de Capri, Imbuí, Salvador/BA', avaliation: '380000', minimunSale: '380000', initialBid: '300000' };
const detalhe = { ...resumo, auction, postalCode: '41720-340', address: 'Rua Estrada das Pedrinhas', number: '190', district: 'Imbuí', city: 'Salvador', state: 'BA',
  process: '0002237-12.2014.4.01.3311 – EXECUÇÃO', description: '$27', status: { code: 'CLOSED' } };
const html = `<html><body><p>Outro lote: VALOR DE AVALIAÇÃO: R$ 83.563,50 · 1º Leilão R$ 83.563,50 · 17 set de 2026</p>
<script>self.__next_f.push([1,"x:${esc({ lots: [resumo] })}"])</script>
<script>self.__next_f.push([1,"y:${esc({ lot: detalhe })}"])</script>
<script>self.__next_f.push([1,"27:T5dd,"])self.__next_f.push([1,"A quota parte de 50% do apartamento, com área de 82,01 m² (oitenta e dois). VALOR DE AVALIAÇÃO: R$ 190.000,00 a quota-parte."])</script></body></html>`;

const url = `https://www.nordesteleiloes.com.br/lotes/${slug}`;
const det = parseDetalhe(html, url);
const r = montarRow(url, det, TENANTS.nordeste);
assert.equal(r.titulo, resumo.title, 'título do payload, com o 50%');
assert.equal(r.valor_avaliacao, 380000, 'avaliação do lote, não a quota-parte do texto');
assert.equal(r.valor_minimo, 300000, 'lance da praça vigente');
assert.equal(r.area_m2, 82.01, 'área da descrição DESTE lote');
assert.equal(r.data_leilao, '2026-09-21'); assert.equal(r.data_leilao_2, '2026-09-28');
assert.equal(r.bairro, 'Imbuí'); assert.equal(r.cep, '41720340'); assert.equal(r.endereco, 'Rua Estrada das Pedrinhas, 190');
assert.equal(r.numero_processo, '0002237-12.2014.4.01.3311');
assert.equal(det.encerrado, true, 'status CLOSED');

// Sem payload: continua o caminho antigo (slug/texto), sem quebrar.
const velho = parseDetalhe('<p>1º Leilão R$ 100.000,00 2º Leilão R$ 60.000,00 10 dez de 2099</p>', 'https://www.nordesteleiloes.com.br/lotes/9-001-casa-com-200-m2-feira-de-santana-bahia');
assert.equal(velho.valor_minimo, 60000); assert.equal(velho.estado, 'BA'); assert.equal(velho.endereco, null);
console.log('ok — NORDESTE lê o lote do payload');
