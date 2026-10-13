// ARES (13/10): catálogo PostgREST → linha do acervo. Formas REAIS do Shiokawa (Bertioga, 2 praças;
// "REPASSE 1" de teste com praça vencida; anúncio "Leads"; categoria eletrônicos).
import assert from 'node:assert/strict';
import { extrairUrlsDeLote, detalhesDoCatalogo, detalheDoLote, montarRow, idDaUrl, TENANTS } from '../lib/ares-parse.mjs';

const T = TENANTS.shiokawa;
const dia = (d) => new Date(Date.now() + d * 864e5).toISOString();
const bertioga = {
  id: '4484768f-51a9-4a56-bf9b-c1fcbbb71338', title: 'Apartamento / Unidade Residencial nº 22 (Bloco Itatinga) – Condomínio Residencial Buriquioca – Bertioga/SP',
  description: '<p>Matrícula nº 41.123 do CRI de Bertioga. Área útil de 64,50 m².</p>', status: 'futuro', evaluation_value: 297131.42,
  address: 'Rua X, 10, Bertioga/SP', latitude: -23.85, longitude: -46.13, judicial_process_number: '1000000-00.2020.8.26.0075',
  featured_image_url: 'https://api.shiokawaleiloes.com.br/storage/v1/object/public/lot-files/a/capa.jpeg',
  cities: { name: 'Bertioga' }, states: { code: 'SP' }, categories: { slug: 'imoveis_residenciais', name: 'Imóveis residenciais' },
  auctions: { auction_type: 'Judicial', status: 'futuro' },
  lot_phases: [{ phase_order: 2, end_date: dia(27), initial_value: 237705 }, { phase_order: 1, end_date: dia(6), initial_value: 297131.42 }],
  lot_images: [{ image_url: 'https://x/2.jpeg', display_order: 1 }, { image_url: 'https://x/1.jpeg', display_order: 0 }],
  lot_documents: [{ title: 'MATRICULA', file_url: 'https://x/m.pdf', document_type: 'matricula' }, { title: 'AVALIAÇÃO', file_url: 'https://x/a.pdf', document_type: 'avaliacao' }],
};
const teste = { ...bertioga, id: 'ec985395-1805-42a2-9237-a1fbcab36986', title: 'REPASSE 1', categories: { slug: 'imoveis_comerciais' }, lot_phases: [{ phase_order: 1, end_date: dia(-56), initial_value: 500 }] };
const leads = { ...bertioga, id: '19627e77-f665-472b-a1be-fe93c1edea80', auctions: { auction_type: 'Leads' }, lot_phases: [{ phase_order: 1, end_date: dia(17), initial_value: 3890000 }] };
const eletro = { ...bertioga, id: '00000000-0000-0000-0000-000000000001', categories: { slug: 'eletronicos' } };
const txt = JSON.stringify([bertioga, teste, leads, eletro]);

// (1) Listagem: só categoria de imóvel; URL pública /lote/<uuid> no SITE (não na API).
const urls = extrairUrlsDeLote(txt, T.base);
assert.deepEqual([...urls.keys()].sort(), [bertioga.id, leads.id, teste.id].sort());
assert.equal(urls.get(bertioga.id), `https://www.shiokawaleiloes.com.br/lote/${bertioga.id}`);
assert.equal(idDaUrl(urls.get(bertioga.id)), bertioga.id);

// (2) Bertioga: 1ª praça vigente, 2ª praça separada; fotos em ordem com a capa primeiro; docs tipados.
const dets = detalhesDoCatalogo(txt, T.base);
const d = dets.get(urls.get(bertioga.id));
const r = montarRow(urls.get(bertioga.id), d, T);
assert.equal(r.fonte_id, `shiokawa_${bertioga.id}`);
assert.equal(r.valor_minimo, 297131.42);
assert.equal(r.valor_minimo_2, 237705);
assert.ok(r.data_leilao_2);
assert.equal(r.modalidade, 'judicial');
assert.deepEqual([r.cidade, r.estado], ['Bertioga', 'SP']);
assert.equal(r.link_matricula, 'https://x/m.pdf');
assert.deepEqual(r.anexos.map(a => a.tipo), ['matricula', 'laudo']);
assert.deepEqual(r.fotos, ['https://api.shiokawaleiloes.com.br/storage/v1/object/public/lot-files/a/capa.jpeg', 'https://x/1.jpeg', 'https://x/2.jpeg']);
assert.equal(r.numero_matricula, '41.123');
assert.equal(r.latitude, -23.85);
assert.equal(d.encerrado, false);

// (3) 1ª praça já fechou → vale a 2ª, sem 2ª extra.
const d2 = detalheDoLote({ ...bertioga, lot_phases: [{ phase_order: 1, end_date: dia(-3), initial_value: 297131.42 }, { phase_order: 2, end_date: dia(18), initial_value: 237705 }] });
assert.equal(d2.valor_minimo, 237705); assert.equal(d2.valor_minimo_2, null); assert.equal(d2.encerrado, false);

// (4) Lote de teste com praça vencida e anúncio "Leads" = fora; coordenada (0,0) não grava.
assert.equal(dets.get(urls.get(teste.id)).encerrado, true);
assert.equal(dets.get(urls.get(leads.id)).encerrado, true);
assert.equal(detalheDoLote({ ...bertioga, latitude: 0, longitude: 0 }).latitude, null);
assert.equal('latitude' in montarRow('u', detalheDoLote({ ...bertioga, latitude: null, longitude: null }), T), false);

console.log('✓ ares-praca-e-filtros: listagem, praças, docs, fotos, teste/Leads e coordenada');
