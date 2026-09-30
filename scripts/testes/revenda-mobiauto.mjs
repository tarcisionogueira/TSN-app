// Revenda pelo MOBIAUTO (30/09): só anúncios do MESMO modelo/ano; mesma versão/motor quando há 3+;
// rótulo diz o portal de onde a média veio (nunca "Webmotors" sobre anúncio do Mobiauto).
import assert from 'node:assert/strict';
import { modeloDoTitulo, marcaMobiauto, modelosMobiauto, anunciosMobiauto, filtrarVersao, revendaPorAnuncios } from '../../src/utils/viabilidadeVeiculo.js';

assert.equal(marcaMobiauto('GM - CHEVROLET'), 'chevrolet');
assert.equal(marcaMobiauto('VW'), 'volkswagen');
assert.equal(marcaMobiauto('I/MERCEDES'), 'mercedes-benz');
assert.equal(marcaMobiauto('MMC'), 'mitsubishi');
assert.deepEqual(modelosMobiauto('c3 aircross excm'), ['c3-aircross', 'c3']);
assert.deepEqual(modelosMobiauto('MONTANA LS 1.4'), ['montana']);

const u = (mod, ano, v, p) => `"offers":{"@type":"Offer","url":"https://www.mobiauto.com.br/comprar/carros/sp-guarulhos/chevrolet/${mod}/${ano}/${v}/detalhes/${p}?page=detail","price":${p}`;
const html = [u('montana', 2015, 'ls-1-4-flex', 48000), u('montana', 2015, 'ls-1-4-flex', 50000), u('montana', 2015, 'ls-1-4-flex', 52000),
  u('montana', 2015, 'sport-1-4-flex', 56000), u('montana', 2016, 'ls-1-4-flex', 60000), u('onix', 2015, 'lt', 40000)].join(',');
const a = anunciosMobiauto(html, { marca: 'chevrolet', modelo: 'montana', ano: 2015 });
assert.equal(a.length, 4, 'outro ano e outro modelo da vitrine não entram');
assert.equal(a[0].local, 'guarulhos/SP');
const f = filtrarVersao(a, 'MONTANA LS 1.4');
assert.equal(f.versao, true);
assert.deepEqual(f.lista.map((x) => x.preco), [48000, 50000, 52000]);
assert.equal(filtrarVersao(a, 'MONTANA FLAT').versao, false, '"flat" não casa com "flex" por substring');
const r = revendaPorAnuncios(f.lista, 55000);
assert.equal(r.base, 'mobiauto');
assert.equal(r.media, 50000);
assert.equal(r.valor, 45000);
assert.equal(modeloDoTitulo('FIAT CRONOS DRIVE 1.3 ANO: 2020/2020 PLACA FINAL 1 (PR)', 'FIAT'), 'CRONOS DRIVE 1.3');
assert.equal(modeloDoTitulo('RENAULT OROCH PRO 16, 2024/2025, Placa FINAL 1 (SP),  (Ref.: MA)', 'RENAULT'), 'OROCH PRO 16');
assert.equal(modeloDoTitulo('CHEVROLET MONTANA LS 2015/2015', 'CHEVROLET'), 'MONTANA LS');
assert.deepEqual(modelosMobiauto(modeloDoTitulo('VOLKSWAGEN NOVA SAVEIRO RB MBVS, 2019/2019, Placa', 'VOLKSWAGEN')), ['saveiro']);
console.log('revenda-mobiauto: todos os casos passaram');
