// Milan Leilões: HTML REAL do evento 15573 (recon_dump id 64, 27/09, via Bright Data), reduzido a
// cabeçalho + 4 cards de formatos diferentes. O card 014 teve o status trocado para VENDIDO para
// cobrir o descarte de encerrado. Home: trecho real do RSC (recon_dump id 57).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extrairEventosImoveis, parseEvento, montarRow, TENANTS, checarQualidade, ehDesafio } from '../lib/milan-parse.mjs';

const BASE = TENANTS.milan.base;
const html = readFileSync(new URL('./fixtures/milan-evento-15573.html', import.meta.url), 'utf8');
const ev = parseEvento(html, 15573, BASE);

assert.equal(ev.tituloEvento, 'Leilão de Imóveis');          // o <h1> do evento, não o do site
assert.equal(ev.inicio, '2026-09-29');                         // ano pela pasta da foto (20260929)
assert.equal(ev.encerramento, '2026-10-01');
assert.equal(ev.edital, 'https://adm.milanleiloes.com.br/CKFiles/files/Edital%20Convencional%20Novo%2029_09_2026v.pdf');
assert.equal(ev.judicial, false);
assert.equal(ev.lotes.length, 4);

const [l1, l8, l10, l14] = ev.lotes;
assert.equal(l1.url, `${BASE}/leilao/15573/lote/001`);
assert.equal(l1.minimo, 36000);
assert.equal(l1.status, 'RECEBENDO LANCES');
assert.equal(l1.foto, 'https://adm.milanleiloes.com.br/Fotos/20260929_15573/001_a.JPG?v=1');
assert.equal(l14.encerrado, true);

const r1 = montarRow(ev, l1, TENANTS.milan);
assert.equal(r1.fonte, 'MILAN'); assert.equal(r1.fonte_id, 'milan_15573_001');
assert.equal(r1.titulo, 'Terreno - Minaçu/GO');
assert.equal(r1.cidade, 'Minaçu'); assert.equal(r1.estado, 'GO');
assert.equal(r1.area_m2, 2847.44);
assert.equal(r1.valor_minimo, 36000);
assert.equal(r1.data_leilao, '2026-09-29');
assert.equal(r1.modalidade, 'extrajudicial');
assert.equal(r1.tipo, 'terreno');
assert.equal(checarQualidade(r1, { estrito: false }).descartar, false);

const r8 = montarRow(ev, l8, TENANTS.milan);                 // travessão "–" em vez de hífen
assert.equal(r8.titulo, 'Casa - Curitiba/PR'); assert.equal(r8.area_m2, 531);

const r10 = montarRow(ev, l10, TENANTS.milan);               // "Apto." → Apartamento
assert.equal(r10.titulo, 'Apartamento - Porto Alegre/RS'); assert.equal(r10.tipo, 'apartamento'); assert.equal(r10.area_m2, 63.47);

const r14 = montarRow(ev, l14, TENANTS.milan);               // "Apto Área Priv." sem ponto
assert.equal(r14.titulo, 'Apartamento - Ribeirão Preto/SP');

// Home: links de banner + agenda do RSC com aspas escapadas; só IMÓVEIS entra.
const home = `<a href="/leilao/imoveis/15582"></a><a href="/leilao/veiculos/15584"></a>`
  + `self.__next_f.push([1,"\\"agenda\\":[{\\"codLeilao\\":15554,\\"categorias\\":\\" Equip. Diversos\\"},`
  + `{\\"codLeilao\\":15605,\\"dataInicio\\":\\"2026-10-02T13:00:00.000+00:00\\",\\"categorias\\":\\" Imóveis\\"}]"])`;
assert.deepEqual(extrairEventosImoveis(home).sort(), ['15582', '15605']);

// Rural em hectares, com nome próprio no trecho do tipo (dry-run real 27/09, evento 15592 lote 003).
const rural = montarRow({ ...ev, cod: '15592' }, { lote: '003', url: `${BASE}/leilao/15592/lote/003`, minimo: 367000, status: 'RECEBENDO LANCES',
  foto: 'https://adm.milanleiloes.com.br/Fotos/20261008_15592/003_a.JPG?v=1',
  titulo: 'Bambui - MG. Zona Rural. Fazenda São Jorge. Áreas Totais. Terr. 21,88ha' }, TENANTS.milan);
assert.equal(rural.titulo, 'Fazenda - Bambui/MG');
assert.equal(rural.area_m2, 218800);
assert.equal(rural.tipo, 'rural');

// "LANCE INICIAL" em vez de "LANCE MÍNIMO" — card REAL do evento 15582 (Porto Seguro), amostra
// milan-sem-valor de 27/09. Era o motivo de 41 dos 69 lotes saírem "sem valor".
const inicial = parseEvento(`<h1>Leilão de  Imóveis</h1><h2><span>Início:</span> 28 SET 11:00</h2><ul><li id="card-001"><div><a href="/leilao/15582/lote/001"><div></div><div><div><div><span id="card_lote_lote__xyHtm">Lote 001</span><p id="card_lote_tituloGrande__w2pVU">Orós - CE. Bairro São Geraldo. Terreno. Áreas Totais. Terr. 10.000,00m²</p><p id="card_lote_lanceMinimo__l2ivg"><span>LANCE INICIAL:</span> R$ 598.500,00</p></div></div><div><div id="estado_lote_tag_estadoLote__QA3i6"><div id="estado_lote_tag_dotEstadolote___Lj6t"></div>RECEBENDO LANCES</div></div></div></a></div></li></ul>`, 15582, BASE);
assert.equal(inicial.lotes[0].minimo, 598500);
assert.equal(inicial.lotes[0].htmlSemValor, null);

// Detector de desafio (27/09): página BOA traz o beacon `challenge-platform` lá no fim; o
// desafio de verdade anuncia no <title>. O 1º dry-run reprovou a home real por isso.
const boa = '<!doctype html><html lang="pt-BR"><head><title>Milan</title></head><body>' + 'x'.repeat(60000)
  + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>';
assert.equal(ehDesafio(boa), false);
assert.equal(ehDesafio('<!DOCTYPE html><html lang="en-US" dir="ltr"><head><title>Just a moment...</title>'), true);

// #310 (24/10): cards REAIS do evento 15605 (recon_dump 68, amostra milan-sem-valor de 27/09, reduzidos ao
// essencial). O lote 002 tem o título em `card_lote_titulo__SdByA`, não em `tituloGrande` — saía "Imóvel" sem
// cidade (milan_15605_002, 15626_008 e 15642_001 ativos assim em 23/10). E o formato novo "Cidade/UF – …".
const ev15605 = parseEvento(`<h1>Leilão de Imóveis</h1><h2><span>Início:</span> 27 OUT 11:00</h2><ul>`
  + `<li id="card-001"><div><a href="/leilao/15605/lote/001"><div><img alt="Lote Americana/SP – Loteamento Morada do Sol - Casa com aprox. 147,15m² (estimada) e Terreno de 263,70m²" src="https://milanleiloes.com.br/_next/image?url=https%3A%2F%2Fadm.milanleiloes.com.br%2FFotos%2F20261027_15605%2F001_amer1.jpg%3Fv%3D1&amp;w=3840&amp;q=75"></div><div><div><div><span id="card_lote_lote__xyHtm">Lote 001</span><p id="card_lote_tituloGrande__w2pVU">Americana/SP – Loteamento Morada do Sol - Casa com aprox. 147,15m² (estimada) e Terreno de 263,70m²</p><p id="card_lote_lanceMinimo__l2ivg"><span>LANCE INICIAL:</span> R$ 330.000,00</p></div></div><div><div id="estado_lote_tag_estadoLote__QA3i6"><div id="estado_lote_tag_dotEstadolote___Lj6t"></div>RECEBENDO LANCES</div></div></div></a></div></li>`
  + `<li id="card-002"><div><a href="/leilao/15605/lote/002"><div><img alt="Lote Porto Seguro/BA – Arraial D’Ajuda - Fazenda com 2,88 Ha." src="https://milanleiloes.com.br/_next/image?url=https%3A%2F%2Fadm.milanleiloes.com.br%2FFotos%2F20261027_15605%2F002_portoseg1.jpg%3Fv%3D1&amp;w=3840&amp;q=75"></div><div><div><div><span id="card_lote_lote__xyHtm">Lote 002</span><p id="card_lote_titulo__SdByA">Porto Seguro/BA – Arraial D’Ajuda - Fazenda com 2,88 Ha.</p><p id="card_lote_lanceMinimo__l2ivg"><span>LANCE INICIAL:</span> R$ 526.000,00</p></div></div><div><div id="estado_lote_tag_estadoLote__QA3i6"><div id="estado_lote_tag_dotEstadolote___Lj6t"></div>RECEBENDO LANCES</div></div></div></a></div></li></ul>`, 15605, BASE);
assert.equal(ev15605.lotes.length, 2);
const [c1, c2] = ev15605.lotes;
assert.equal(c2.titulo, 'Porto Seguro/BA – Arraial D’Ajuda - Fazenda com 2,88 Ha.');
const m1 = montarRow(ev15605, c1, TENANTS.milan), m2 = montarRow(ev15605, c2, TENANTS.milan);
assert.equal(m1.titulo, 'Casa - Americana/SP'); assert.equal(m1.cidade, 'Americana'); assert.equal(m1.estado, 'SP');
assert.equal(m2.titulo, 'Fazenda - Porto Seguro/BA'); assert.equal(m2.cidade, 'Porto Seguro'); assert.equal(m2.estado, 'BA');
assert.equal(m2.area_m2, 28800); assert.equal(m2.valor_minimo, 526000);
assert.ok(m2.descricao.includes('Arraial'));
// Galpão no formato novo (milan_15605_003, gravado em 23/10 com título "Imóvel").
const g = montarRow(ev15605, { ...c1, lote: '003', titulo: 'São Bernardo do Campo/SP – Bairro Taboão – Galpão Industrial com 474,93m² e Terreno de 1.000,00m²' }, TENANTS.milan);
assert.equal(g.titulo, 'Galpão - São Bernardo do Campo/SP');
// Card sem o <p> do título: o alt da foto segura.
const soAlt = parseEvento(`<ul><li id="card-009"><div><a href="/leilao/15642/lote/009"><img alt="Lote Curitiba/PR – Bairro Água Verde - Apartamento 60m²" src="x"><span>Lote 009</span></a></div></li></ul>`, 15642, BASE);
assert.equal(soAlt.lotes[0].titulo, 'Curitiba/PR – Bairro Água Verde - Apartamento 60m²');

console.log('milan-parse: todos os casos passaram');
