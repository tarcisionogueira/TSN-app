// Milan — imóveis de vários lotes pelo catálogo da siteback (16/11). Fixture: /leiloes/15701/catalogo REAL (16/11),
// reduzido a 3 lotes: 001 (Manicore/AM, terreno, descrição com IPTU) · 007 (Rio de Janeiro/RJ, apto) · 012 com
// `venda` forçada (encerrado).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventoDoCatalogo, editalDoCatalogo, textoDoHtml } from '../lib/milan-siteback.mjs';
import { TENANTS, montarRow, checarQualidade } from '../lib/milan-parse.mjs';

const cat = JSON.parse(readFileSync(new URL('./fixtures/milan-catalogo-imoveis-15701.json', import.meta.url), 'utf8'));
const ev = eventoDoCatalogo(cat);

assert.equal(ev.cod, '15701');
assert.equal(ev.judicial, false);
// Edital no comentarioCatalogo, link relativo → absoluto no adm.
assert.equal(ev.edital, 'https://adm.milanleiloes.com.br/CKFiles/files/Edital%20Convencional%20Novo%2024_11_2026(1).pdf');
assert.equal(ev.lotes.length, 3);

const [l1, l7, l12] = ev.lotes;
assert.equal(l1.lote, '001'); assert.equal(l1.minimo, 24000); assert.equal(l1.encerrado, false);
assert.equal(l1.foto, 'https://adm.milanleiloes.com.br/Fotos/20261124_15701/001_a.JPG');
assert.equal(l1.url, 'https://milanleiloes.com.br/leilao/15701/lote/001');
// Lote sem `fechamento` próprio cai no fim do EVENTO (26/11), nunca no início (24/11): a limpeza por data tiraria
// o lote do acervo no primeiro dia de lances.
assert.equal(l1.data, '2026-11-26'); assert.equal(l7.data, '2026-11-26');
assert.match(l1.descricao, /débitos de IPTU/);                     // entidade &eacute; decodificada, tags fora
assert.doesNotMatch(l1.descricao, /<|&[a-z]+;/);
assert.equal(l12.encerrado, true);

const row = montarRow({ ...ev, inicio: l7.data }, l7, TENANTS.milan);
assert.equal(row.fonte_id, 'milan_15701_007');
assert.equal(row.cidade, 'Rio de Janeiro'); assert.equal(row.estado, 'RJ');
assert.equal(row.valor_minimo, 14000); assert.equal(row.data_leilao, '2026-11-26');
assert.equal(row.link_edital, ev.edital);
assert.equal(checarQualidade(row, { estrito: false }).descartar, false);

// Sem link .pdf no comentário → sem edital (e nunca lança).
assert.equal(editalDoCatalogo({ comentarioCatalogo: '<p>sem edital</p>' }), null);
assert.equal(editalDoCatalogo({}), null);
assert.equal(textoDoHtml('a&nbsp;b<br/>c &ordm; &#8203;'), 'a b c º');

console.log('milan-imoveis-catalogo: ok');
