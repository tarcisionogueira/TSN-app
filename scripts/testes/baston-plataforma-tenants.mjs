// BASTON como PLATAFORMA (26/10): Custódio e André Araújo rodam o mesmo front ("Plataforma Baston Leilões" no rodapé,
// static.bastonleiloes.com.br). Fixture REAL: os 8 cards de /leiloes/imoveis do Custódio lidos pelo banco (pg_net) em
// 26/10 — 2 são SIMULADORES da plataforma ("/simulacao/simulador/", "simulador-tjdft") e não podem virar leilão.
// Completude: o catálogo do Custódio declara 8 cards; 6 reais + 2 simuladores = 8 (100%).
import assert from 'node:assert/strict';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl } from '../lib/baston-parse.mjs';

const catalogoCustodio = `
<section class="leilao-card" data-url="/leilao/simulacao/simulacao/simulador/22328">
<section class="leilao-card" data-url="/leilao/1-simulador/simulador-brasilia/simulador-tjdft/25894">
<section class="leilao-card" data-url="/leilao/2-vara-familia-orfaos-sucessoes/aguas-claras/tribunal-justica-distrito-federal-territorios/30740">
<section class="leilao-card" data-url="/leilao/8-vara-civel/juiz-fora/tribunal-justica-minas-gerais/30752">
<section class="leilao-card" data-url="/leilao/1-unidade-jurisdicional/uberlandia/tribunal-justica-minas-gerais/30368">
<section class="leilao-card" data-url="/leilao/2-vara-civel-cartas-precatorias-civeis/guaxupe/tribunal-justica-minas-gerais/30570">
<section class="leilao-card" data-url="/leilao/2-vara-execucao-titulos-extrajudiciais-conflitos-arbitrais/brasilia/tribunal-justica-distrito-federal-territorios/30910">
<section class="leilao-card" data-url="/leilao/3-vara-execucao-titulos-extrajudiciais-conflitos-arbitrais/brasilia/tribunal-justica-distrito-federal-territorios/30870">`;

const T = TENANTS.custodio;
assert.ok(T && TENANTS.andrearaujo, 'tenants Custódio e André Araújo configurados');
assert.equal(new Set(Object.values(TENANTS).map((t) => t.fonte)).size, Object.keys(TENANTS).length, 'fonte duplicada');

const cards = (catalogoCustodio.match(/data-url=/g) || []).length;
const ev = extrairUrlsDeEvento(catalogoCustodio, T.base);
assert.equal(cards, 8);
assert.deepEqual([...ev.keys()].sort(), ['30368', '30570', '30740', '30752', '30870', '30910']);
assert.ok([...ev.values()].every((u) => u.startsWith('https://www.custodioleiloes.com.br/leilao/')), 'evento no domínio do tenant');

// Lote do leilão: o link pode vir com o domínio da Baston — normaliza para o tenant e o id não colide entre sites.
const lotes = extrairUrlsDeLote('<a href="https://www.bastonleiloes.com.br/leilao/30740/lote/1/casa-em-aguas-claras">', T.base);
assert.equal(lotes.get('30740_1'), 'https://www.custodioleiloes.com.br/leilao/30740/lote/1/casa-em-aguas-claras');
assert.equal(idDaUrl(lotes.get('30740_1')), '30740_1');

console.log('ok — baston plataforma: custódio 6/8 cards reais (2 simuladores fora), andré araújo configurado');
