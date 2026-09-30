// Revenda pelo MOBIAUTO (30/09): só anúncios do MESMO modelo/ano; mesma versão/motor quando há 3+;
// rótulo diz o portal de onde a média veio (nunca "Webmotors" sobre anúncio do Mobiauto).
import assert from 'node:assert/strict';
import { modeloDoTitulo, marcaMobiauto, modelosMobiauto, anunciosMobiauto, filtrarVersao, revendaPorAnuncios, slugMobiauto } from '../../src/utils/viabilidadeVeiculo.js';

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
const st = (v, p) => `"url":"https://www.mobiauto.com.br/comprar/carros/sp-sao-paulo/fiat/strada/2025/${v}/detalhes/${p}?page=detail","price":${p}`;
const as = anunciosMobiauto([st('endurance-1-3-flex-8v-cs', 100000), st('endurance-1-3-flex-8v-cs', 101000), st('endurance-1-3-flex-8v-cs', 102000), st('ultra-1-0-turbo', 130000)].join(','), { marca: 'fiat', modelo: 'strada', ano: 2025 });
assert.deepEqual(filtrarVersao(as, 'STRADA ENDURAN CS13').lista.map((x) => x.preco), [100000, 101000, 102000], 'abreviação do título casa por prefixo');
console.log('revenda-mobiauto: todos os casos passaram');

// ── OLX (30/09): card REAL da busca "mitsubishi l200 triton 2021" (lido via banco), + slugs da marca ──
{
  const { anunciosOlx, slugsModeloMobiauto } = await import('../../src/utils/viabilidadeVeiculo.js');
  const card = (id, titulo, km, preco, local) => `<section class="olx-adcard  olx-adcard__vertical undefined" data-mode="vertical"><div class="olx-adcard__content"><div class="olx-adcard__topbody"><a data-testid="adcard-link" class="olx-adcard__link" title="${titulo}" href="https://rj.olx.com.br/rio-de-janeiro-e-regiao/autos-e-pecas/carros-vans-e-utilitarios/x-${id}"><h2 class="typo-body-large olx-adcard__title font-semibold">${titulo}</h2></a><div ><div class="olx-adcard__details"><div class="olx-adcard__detail" aria-label="${km} quilômetros rodados"><svg xmlns="http://www.w3.org/2000/svg" width="16"><path fill-rule="evenodd" fill="currentColor"></path></svg> <!-- -->70.000 km</div></div></div><div class="olx-adcard__mediumbody"><h3 class="typo-body-large olx-adcard__price font-semibold">R$ ${preco}</h3></div><div class="olx-adcard__bottombody"><div class="olx-adcard__location-date"><p class="typo-caption olx-adcard__location"><svg xmlns="http://www.w3.org/2000/svg" width="16"><path fill-rule="evenodd" fill="currentColor"></path></svg> <!-- -->${local}</p><p class="typo-caption olx-adcard__date">Ontem, 11:14</p></div></div></div></section>`;
  const html = [
    card(1, 'Mitsubishi L200 Triton Sport HPE-S 2.4 CD Dies. AUT 2021', 70000, '169.890', 'Rio de Janeiro -  RJ'),
    card(2, 'Mitsubishi L200 Triton Sport GLS 2.4 CD Diesel Aut. 2021', 88000, '147.900', 'Cuiabá - MT'),
    card(3, 'Mitsubishi L200 Triton Sport GLS 2.4 CD Diesel Aut. 2021', 91000, '149.900', 'Goiânia - GO'),
    card(4, 'Mitsubishi L200 Triton Sport GLS 2.4 CD Diesel Aut. 2022', 30000, '189.900', 'Goiânia - GO'),   // outro ano
    card(5, 'Mitsubishi Pajero Sport HPE 2021', 60000, '199.000', 'Goiânia - GO'),                          // outro modelo
    card(6, 'Mitsubishi L200 Triton Sport GLS 2.4 CD Diesel Aut. 2021', 99000, '138.500', 'Campinas - SP'),
  ].join('');
  const o = anunciosOlx(html, { ano: 2021, modelo: 'L200 TRITON SPO GL 2.5' });
  assert.equal(o.length, 4, 'só L200 de 2021');
  assert.deepEqual(o[0], { preco: 169890, titulo: 'Mitsubishi L200 Triton Sport HPE-S 2.4 CD Dies. AUT 2021', ano: 2021, km: 70000,
    local: 'Rio de Janeiro/RJ', portal: 'olx', url: 'https://rj.olx.com.br/rio-de-janeiro-e-regiao/autos-e-pecas/carros-vans-e-utilitarios/x-1',
    versao: 'mitsubishi-l200-triton-sport-hpe-s-2-4-cd-dies-aut-2021' });
  // "triton" casa com TODOS: não distingue versão. "gl" ≠ "gls" (segmento inteiro) → modelo/ano inteiro, sem dizer "mesma versão".
  const fv = filtrarVersao(o, 'L200 TRITON SPO GL 2.5');
  assert.equal(fv.versao, false);
  assert.equal(fv.lista.length, 4);
  assert.equal(filtrarVersao(o, 'L200 TRITON GLS 2.4').lista.length, 3, 'GLS separa das HPE-S');
  const rv = revendaPorAnuncios(o, 148637);
  assert.equal(rv.base, 'olx');
  assert.equal(rv.anuncios.length, 4);
  // Página da marca/ano do Mobiauto: descobre "l200-triton-sport" a partir do candidato "l200-triton".
  const marcaAno = ['asx', 'l200-triton-outdoor', 'l200-triton-sport', 'pajero-sport', 'ano-2021', 'triton']
    .map((m) => `<a href="/comprar/carros/brasil/mitsubishi/${m}">`).join('') + '<a href="/comprar/carros/brasil/fiat/l200-triton-x">';
  assert.deepEqual(slugsModeloMobiauto(marcaAno, 'mitsubishi', ['l200-triton', 'l200']), ['l200-triton-outdoor', 'l200-triton-sport']);
  console.log('revenda-olx: todos os casos passaram');
}

// Mobiauto + OLX juntos (30/09): "triton" é nome do MODELO — no Mobiauto fica fora do trecho de versão,
// na OLX está no título. Sem `ignorar`, o filtro chamava de "mesma versão" só os da OLX.
{
  const { anunciosOlx } = await import('../../src/utils/viabilidadeVeiculo.js');
  const mob = [1, 2, 3].map((i) => ({ preco: 150000 + i, portal: 'mobiauto', url: `https://www.mobiauto.com.br/comprar/carros/mt-cuiaba/mitsubishi/l200-triton-sport/2021/hpe-s-2-4-cd-diesel-aut/detalhes/${i}` }));
  const olx = ['Mitsubishi L200 Triton Sport GLS 2.4 CD Diesel Aut. 2021', 'Mitsubishi L200 Triton Sport HPE 2.4 CD Diesel Aut. 2021', 'Mitsubishi L200 Triton Sport HPE-S 2.4 CD Dies. AUT 2021']
    .map((t, i) => ({ preco: 140000 + i, portal: 'olx', url: `https://x/${i}`, versao: slugMobiauto(t) }));
  assert.ok(anunciosOlx);
  const semIgnorar = filtrarVersao([...mob, ...olx], 'L200 TRITON SPO GL 2.5');
  assert.equal(semIgnorar.versao, true, 'o defeito: sem ignorar, "triton" separava OLX de Mobiauto');
  const certo = filtrarVersao([...mob, ...olx], 'L200 TRITON SPO GL 2.5', ['l200-triton', 'l200', 'l200-triton-sport']);
  assert.equal(certo.versao, false, 'GL 2.5 não existe em nenhum anúncio: modelo/ano inteiro');
  assert.equal(certo.lista.length, 6);
  console.log('revenda-mistura: todos os casos passaram');
}
