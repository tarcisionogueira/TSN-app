// ARES — 8 tenants novos da triagem da junta (26/10). Fixtures REAIS lidas pelo banco (pg_net + ?apikey=) em 26/10,
// encurtadas na descrição: POLI (fazenda + veículo leve) e DR (automóvel + moto). Cada tenant batiza a categoria do
// seu jeito — `fazendas`, `veiculos_leves`, `automoveis`, `motos_e_similares` — e a regra antiga (só /^imove/ e
// /^veicul/) deixava 4 fazendas vivas da POLI e todos os veículos da DR fora da coleta, sem erro nenhum.
import assert from 'node:assert/strict';
import { extrairUrlsDeLote, extrairUrlsDeVeiculo, detalhesDoCatalogo, montarRow, TENANTS } from '../lib/ares-parse.mjs';

const fazenda = {
  id: 'e32a857b-a193-4626-b0fb-be663f469e11', title: ' Área de Terras com área de 500ha, imóvel rural denominado Fazenda Bom Retiro II, situado na Gleba Atlântica, próximo a Nova Ubiratã/MT, no município de Vera/MT.',
  cities: { name: 'Sorriso' }, states: { code: 'MT' }, status: 'aberto', address: '',
  auctions: { title: '3ª Vara Cível de Sorriso/MT', status: 'aberto', auction_type: 'Judicial' },
  categories: { name: 'Fazendas', slug: 'fazendas' },
  lot_images: [{ image_url: 'https://api.polileiloes.net/storage/v1/object/public/lot-files/e32a857b/photos/1789654487310-9td5n61ar5o.jpg', display_order: 0 }],
  lot_phases: [{ end_date: '2099-10-20T18:35:00+00:00', phase_order: 1, initial_value: 5841200.64 }, { end_date: '2099-10-29T18:30:00+00:00', phase_order: 2, initial_value: 3504720 }],
  description: '<p><strong>Bem(ns):</strong> Área de Terras com área de 500ha ... matrícula nº 3.883 do CRI de Sinop/MT ... avaliadas em R$ 5.386.000,00</p>',
  lot_documents: [{ title: 'Certidão Matricula Atual 2025', file_url: 'https://api.polileiloes.net/x/m.pdf', document_type: 'matricula' }],
  judicial_court: '3ª Vara Cível de Sorriso/MT', lot_attributes: [], evaluation_value: 5841200.64, judicial_process_number: '00002136-67.2000.8.11.0040',
};
const versa = {
  ...fazenda, id: 'b2a89058-bcf3-457b-994f-fcba63398bbf', title: 'Um veículo NISSAN VERSA 16SV FLEX, 2012/2013',
  cities: { name: 'Diamantino' }, categories: { name: 'Veículos leves', slug: 'veiculos_leves' }, evaluation_value: 35282,
  lot_phases: [{ end_date: '2099-11-12T18:30:00+00:00', phase_order: 1, initial_value: 35282 }],
};
const uno = {
  ...fazenda, id: '12f864b9-a9b7-4624-bb50-4216511ded6e', title: 'UNO MILLE SX - 1997 - AZUL', cities: { name: 'Americana' }, states: { code: 'SP' },
  categories: { name: 'Automóveis', slug: 'automoveis' }, evaluation_value: 10036,
  lot_phases: [{ end_date: '2099-11-26T18:00:00+00:00', phase_order: 1, initial_value: 10036 }],
};
const moto = { ...uno, id: 'b1e8a718-185f-4a97-843c-1a8d5dddb72a', title: 'MOTOCICLETA - YAMAHA - YBR 125K - VERMELHA - 2008/2008', categories: { name: 'Motos e similares', slug: 'motos_e_similares' } };
const eletro = { ...uno, id: '00000000-0000-0000-0000-0000000000e1', title: 'Notebook', categories: { slug: 'eletronicos' } };

// (1) Os 8 tenants novos estão lá, com `fonte` única e API própria.
const novos = ['drleiloes', 'grupoarremate', 'dbm', 'poli', 'mauromarcello', 'brame', 'rocket', 'stilo'];
for (const k of novos) {
  assert.ok(TENANTS[k], `tenant ${k} configurado`);
  assert.match(TENANTS[k].headers.apikey, /^sb_publishable_/);
  assert.match(TENANTS[k].base, /^https:\/\/api\./);
}
const fontes = Object.values(TENANTS).map((t) => t.fonte);
assert.equal(new Set(fontes).size, fontes.length, 'fonte duplicada entre tenants ARES');

// (2) POLI: fazenda entra como imóvel (antes ficava fora), veículo leve vai para veículos — nunca nos dois.
const P = TENANTS.poli;
const txtPoli = JSON.stringify([fazenda, versa, eletro]);
const imv = extrairUrlsDeLote(txtPoli, P.base);
assert.deepEqual([...imv.keys()], [fazenda.id]);
assert.equal(imv.get(fazenda.id), `https://www.polileiloes.com.br/lote/${fazenda.id}`, 'URL pública no domínio da junta, não na API .net');
const vei = extrairUrlsDeVeiculo(txtPoli, P.base);
assert.deepEqual([...vei.keys()], [versa.id]);

const det = detalhesDoCatalogo(txtPoli, P.base).get(imv.get(fazenda.id));
const row = montarRow(imv.get(fazenda.id), det, P);
assert.equal(row.fonte, 'POLILEILOES');
assert.equal(row.fonte_id, `polileiloes_${fazenda.id}`);
assert.deepEqual([row.cidade, row.estado], ['Sorriso', 'MT']);
assert.equal(row.modalidade, 'judicial');
assert.equal(row.valor_minimo, 5841200.64);

// (3) DR: `automoveis` e `motos_e_similares` são veículo; eletrônico não entra em lugar nenhum.
const D = TENANTS.drleiloes;
const txtDr = JSON.stringify([uno, moto, eletro]);
assert.deepEqual([...extrairUrlsDeVeiculo(txtDr, D.base).keys()].sort(), [moto.id, uno.id].sort());
assert.equal(extrairUrlsDeLote(txtDr, D.base).size, 0);
assert.equal(extrairUrlsDeVeiculo(txtDr, D.base).get(uno.id), `https://www.drleiloes.com.br/lote/${uno.id}`);

console.log('ok — ares tenants novos (8) + categorias fazendas/veiculos_leves/automoveis/motos');
