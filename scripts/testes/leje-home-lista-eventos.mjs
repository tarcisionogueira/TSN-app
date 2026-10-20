/**
 * npm run testar:leje — a home do LEJE lista EVENTOS, e o evento de lote único é o próprio lote.
 * Trechos com a MESMA forma do HTML real de 20/10 (recon Firecrawl: home com 43 `acao=evento&cod=N`
 * e nenhum `lote=`; evento 7873 "Lote Único" com a linha "ID: 7873", a âncora `cod=7873#`, galeria em
 * `swiper-slide` e logo do tribunal). O extrator antigo exigia `lote=` e enumerava 0 — #250.
 */
import assert from 'node:assert/strict';
import { extrairUrlsDeEvento, extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl } from '../lib/leje-parse.mjs';

const base = 'https://leje.com.br';
const home = `
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7873"><div class="card-leilao">ABERTO PARA LANCES</div><span>ID 7873</span></a>
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7920">x</a>
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7920">x de novo</a>
  <a href="https://leje.com.br/index.php?acao=cadastro_simples">cadastre-se</a>`;
const evento = `
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7873#close">x</a>
  <div id="auction-detail-owner"><p>4ª vara cível guaruja</p><img src="https://leje.com.br/storage/public/tribunais/1_1573673827.png"></div>
  <div class="swiper-slide"> <img data-slide-index="0" src="https://leje.com.br/storage/public/imagem/cb33621f.jpeg"></div>
  <div class="swiper-slide"> <img data-slide-index="1" src="https://leje.com.br/storage/public/imagem/a057cbc7.jpeg"></div>
  <p>ABERTO PARA LANCES</p><p>ID: 7873</p><p>9089</p>
  <p>APARTAMENTO NO 9° ANDAR COM 191,455 M² NO EDIFÍCIO ANTARES EM GUARUJÁ/SP</p><p>Lote Único</p>
  <p>1º Leilão 16/NOV/2026 - 11:30hs</p><p>Valor de avaliação R$ 728.698,43</p>
  <p>Valor de avaliação: R$ 728.698,43</p><p>Valor de 2º leilão: R$ 364.349,21</p><p>Matrícula nº: 85.725</p>
  <div class="card-leilao"><img src="https://leje.com.br/storage/public/imagem/outro-leilao.png"></div>
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7920">outro evento</a>`;
const eventoVariosLotes = `
  <p>ID: 7833</p><a href="https://leje.com.br/index.php?acao=evento&amp;cod=7833#">x</a>
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7833&amp;lote=18829">Lote 1</a>
  <a href="https://leje.com.br/index.php?acao=evento&amp;cod=7833&amp;lote=18830">Lote 2</a>`;

const evs = extrairUrlsDeEvento(home, base);
assert.deepEqual([...evs.keys()].sort(), ['7873', '7920'], 'home → eventos distintos');
assert.equal(extrairUrlsDeLote(home, base).size, 0, 'cartão "ID 7873" da home NÃO é lote (sem a âncora do evento)');
assert.equal(detalhesDoCatalogo(home, base).size, 0, 'home não gera detalhe');

const lotes = extrairUrlsDeLote(evento, base);
assert.deepEqual([...lotes], [['e7873', 'https://leje.com.br/index.php?acao=evento&cod=7873']], 'lote único = o próprio evento');
const [[url, det]] = [...detalhesDoCatalogo(evento, base)];
assert.equal(url, 'https://leje.com.br/index.php?acao=evento&cod=7873');
assert.equal(det.cidade, 'Guarujá', 'cidade é o que vem depois do último " em "');
assert.equal(det.estado, 'SP');
assert.equal(det.valor_avaliacao, 728698.43);
assert.equal(det.link_foto, 'https://leje.com.br/storage/public/imagem/cb33621f.jpeg', 'foto da galeria, nunca o logo do tribunal nem cartão de outro leilão');
assert.deepEqual(det.fotos, ['https://leje.com.br/storage/public/imagem/cb33621f.jpeg', 'https://leje.com.br/storage/public/imagem/a057cbc7.jpeg']);

const varios = extrairUrlsDeLote(eventoVariosLotes, base);
assert.deepEqual([...varios.keys()], ['18829', '18830'], 'evento com vários lotes segue pelos links lote=');
assert.equal(detalhesDoCatalogo(eventoVariosLotes, base).size, 0, 'evento com vários lotes não vira lote único');

assert.equal(idDaUrl('https://leje.com.br/index.php?acao=evento&cod=7833&lote=18830'), '18830', 'id antigo preservado');
assert.equal(idDaUrl('https://leje.com.br/index.php?acao=evento&cod=7873'), 'e7873', 'id novo com prefixo');
console.log('✓ leje: home de eventos, lote único, vários lotes, cidade e foto');
