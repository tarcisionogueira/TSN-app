/**
 * scripts/testes/globo-json.mjs — 29/09. GLOBOLEILOES pelo JSON `data-page` (lib/globo-json.mjs).
 * Campos e valores no formato medido nas páginas reais (pg_net, 29/09).
 */
import { dataPage, lerListagem, lerDetalhe, montarRowGlobo, pracaAtual, leiloeiroGlobo, tipoGlobo } from '../lib/globo-json.mjs';

let falhas = 0;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };
const pagina = (obj) => `<div id="app" data-page="${JSON.stringify(obj).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`;

const proprio = {
  id: 3903, uf: 'SP', url: null, city: 'Mairiporã', neighborhood: 'Terra Preta', slug: 'lote-1-sp-mairipora-terra-preta-terreno-lote-700-m2',
  full_title: 'Lote 1 - SP - Mairiporã - Terra Preta | Terreno / Lote - 700 m²', title: '700 m²', category_id: 1,
  subcategory: { name: 'Terreno / Lote' }, avaliation: '202.186,30', photo: null,
  description: '<p><strong>INFORMAÇÕES DO ATIVO:</strong></p><ul><li><p>Tipo: Terreno urbano.</p></li></ul>',
  values: [{ status: 2, price: '141.530,41', start: '2026-09-03T14:00:00Z', end: '2026-09-18T14:00:00Z' },
    { status: 1, price: '141.530,41', start: '2026-09-18T14:00:00Z', end: '2026-10-05T14:00:00Z' },
    { status: 0, price: '141.530,41', start: '2026-10-05T14:00:00Z', end: '2026-10-19T14:00:00Z' }],
};
const parceiro = {
  id: 2087, uf: 'MT', url: 'https://balbinoleiloes.com.br/leiloes/lote-1-mt-diamantino-fazenda/771', city: 'Diamantino', neighborhood: '',
  full_title: 'Lote 1 - MT - Diamantino | Fazenda - Cachoeirinha - 99ha', title: 'Cachoeirinha - 99ha', category_id: 3,
  subcategory: { name: 'Fazenda' }, avaliation: '904.374,50', photo: '1-o4mtcew3i1fw8h0.webp', partner: { type: { slug: 'judicial' } },
  values: [{ status: 2, price: '904.374,50', start: '2026-09-11T19:00:00Z', end: '2026-09-14T19:00:00Z' },
    { status: 1, price: '452.187,25', start: '2026-09-14T19:00:00Z', end: '2026-09-29T19:00:00Z' }],
};

console.log('\nGLOBO pelo JSON');
const lst = lerListagem(pagina({ component: 'Lots/List/Index', props: { initialLots: { data: [proprio, parceiro], total: 728, last_page: 73, current_page: 2 } } }));
ok(lst && lst.lotes.length === 2 && lst.total === 728 && lst.ultima === 73 && lst.pagina === 2, 'listagem lida do data-page (entidades decodificadas)');
ok(dataPage('<div>sem app</div>') === null && lerListagem('<div data-page="{quebrado"></div>') === null, 'página sem JSON → null (quem chama trata como falha)');

ok(pracaAtual(parceiro).price === '452.187,25', 'praça vigente = a aberta (status 1), não a encerrada');
ok(pracaAtual({ values: [{ status: 2, price: '1' }, { status: 0, price: '9', start: '2026-12-01' }, { status: 0, price: '8', start: '2026-11-01' }] }).price === '8', 'sem praça aberta → a próxima futura');

let r = montarRowGlobo(parceiro);
ok(r.fonte_id === 'globoleiloes_2087' && r.valor_minimo === 452187.25 && r.valor_avaliacao === 904374.5, `parceiro: lance da praça vigente ${r.valor_minimo}, avaliação ${r.valor_avaliacao}`);
ok(r.leiloeiro === 'Balbino Leilões' && r.url_lote === parceiro.url && r.tipo === 'rural', 'parceiro: leiloeiro e link do site do parceiro, tipo rural');
ok(r.link_foto === 'https://d1etsb4iun2r36.cloudfront.net/auctions/partners/lots/1-o4mtcew3i1fw8h0.webp', 'foto do parceiro no caminho conferido (200 image/webp)');
ok(r.data_leilao === '2026-09-29T19:00:00Z' && r.cidade === 'Diamantino' && r.estado === 'MT', 'data = fim da praça vigente; cidade/UF do JSON');

const det = lerDetalhe(pagina({ component: 'Lots/Show/Index', props: { lot: {
  images: [{ name: 'b.webp', order: 1 }, { name: 'a.webp', order: 0 }],
  files: [{ file: 'x.pdf', name: 'Matrícula 41.404' }, { file: 'y.pdf', name: 'Avaliação' }], street: 'Rua das Flores, 10', zip_code: '07600-000' } } }));
r = montarRowGlobo(proprio, det);
ok(r.titulo === 'SP - Mairiporã - Terra Preta | Terreno / Lote - 700 m²' && r.tipo === 'terreno' && r.area_m2 === 700, `próprio: título sem "Lote 1 -", terreno, 700 m² (${r.area_m2})`);
ok(r.leiloeiro === 'Globo Leilões' && r.url_lote === 'https://globoleiloes.com.br/leiloes/lote-1-sp-mairipora-terra-preta-terreno-lote-700-m2/3903', 'próprio: link da página da Globo');
ok(r.fotos[0].endsWith('/lots/images/intern_a.webp') && r.link_matricula.endsWith('/lots/files/x.pdf') && r.anexos[1].tipo === 'laudo', 'fotos na ordem, matrícula e laudo dos PDFs');
ok(r.cep === '07600000' && r.endereco === 'Rua das Flores, 10' && r.descricao.startsWith('INFORMAÇÕES DO ATIVO'), 'CEP, endereço e descrição sem HTML');

r = montarRowGlobo(proprio);
ok(!('link_foto' in r) && !('anexos' in r) && !('fotos' in r), 'sem detalhe lido: foto/anexos AUSENTES (não viram null por cima dos já gravados)');
ok(leiloeiroGlobo({ url: 'https://mercado.bomvalor.com.br/x' }) === 'Bom Valor' && tipoGlobo({ subcategory: { name: 'Apartamento' } }) === 'apartamento' && tipoGlobo({ category_id: 2, subcategory: null }) === 'comercial', 'Bom Valor; tipos por subcategoria e por categoria');

ok(montarRowGlobo({ ...proprio, description: '&lt;h2&gt;&lt;strong&gt;INFORMAÇÕES&lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;Casa &amp;amp; quintal&lt;/p&gt;' }).descricao === 'INFORMAÇÕES \nCasa & quintal' || !/[<>]|&lt;/.test(montarRowGlobo({ ...proprio, description: '&lt;h2&gt;X&lt;/h2&gt;' }).descricao), 'descrição com tags escapadas sai limpa');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
