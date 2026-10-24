// Fotos da HASTA (24/10, #289): o parser não lia imagem nenhuma. Fixture com as URLs REAIS do lote
// /item/11770 (lidas pelo banco em 24/10): og:image na pasta bens/<id>/, banner e logos que não são foto.
import assert from 'node:assert/strict';
import { parseDetalhe, montarRow } from '../lib/hasta-parse.mjs';

const CAPA = 'https://daaotz9z9advj.cloudfront.net/bens/0000007609/img-7609-6ad7d74be6f98.jpg';
const html = `<html><head><meta property="og:image" content="${CAPA}" /></head><body>
<img src="https://www.hastaleiloes.com.br/site/images/logo-header.png?v=20260918123952">
<div class="galeria"><img src="${CAPA}"><img src="https://daaotz9z9advj.cloudfront.net/bens/0000007609/img-7609-segunda.jpg"></div>
<img src="https://www.hastaleiloes.com.br/glide/comitentes/000068-caixa-economica-federal-66974e15f38f5.jpg/thumb?w=200">
<img src="https://daaotz9z9advj.cloudfront.net/banners/banner-modal-caixa-6ad81a475d863.jpeg">
Cidade: Maceió/AL Data 1º Leilão: 28/12/2099 10:00 Lance Inicial: R$169.588,26</body></html>`;

const det = parseDetalhe(html, 'https://www.hastaleiloes.com.br/item/11770/detalhes');
assert.equal(det.link_foto, CAPA, 'capa = og:image da pasta do lote');
assert.deepEqual(det.fotos, [CAPA, 'https://daaotz9z9advj.cloudfront.net/bens/0000007609/img-7609-segunda.jpg'], 'galeria só da pasta do lote, sem banner/logo/comitente');

const row = montarRow('https://www.hastaleiloes.com.br/item/11770/detalhes', det, { fonte: 'HASTA', leiloeiro: 'Hasta Leilões' });
assert.equal(row.link_foto, CAPA);
assert.equal(row.fotos.length, 2);

// Página sem foto do lote: nada inventado, e a linha não leva `fotos` (não apaga galeria anterior).
const semFoto = parseDetalhe('<html><body><img src="https://daaotz9z9advj.cloudfront.net/banners/x.jpeg">Cidade: Maceió/AL</body></html>', 'https://www.hastaleiloes.com.br/item/1/detalhes');
assert.equal(semFoto.link_foto, null);
assert.ok(!('fotos' in montarRow('https://www.hastaleiloes.com.br/item/1/detalhes', semFoto, { fonte: 'HASTA', leiloeiro: 'Hasta' })));
console.log('ok — hasta-fotos');
