// e-LEILÕES (13/10): __NUXT_DATA__ (devalue) → linha do acervo. Valores REAIS do lote 38390 (Nuporanga):
// valorMinimo vem 0 e o lance mora em valorInicial/valorInicial2 — na 2ª praça o mínimo é o da 2ª.
import assert from 'node:assert/strict';
import { parseDetalhe, extrairUrlsDeLote, montarRow, decodificarNuxt, TENANTS } from '../lib/eleiloes-parse.mjs';

// Codificador devalue mínimo (o mesmo achatamento do Nuxt, com o embrulho ShallowReactive na raiz).
function devalue(root) {
  const arr = [['ShallowReactive', 1]];
  const put = (v) => {
    const i = arr.length; arr.push(null);
    if (Array.isArray(v)) arr[i] = v.map(put);
    else if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = put(x); arr[i] = o; }
    else arr[i] = v;
    return i;
  };
  put(root);
  return JSON.stringify(arr);
}
const pagina = (payload, extra = '') => `<html>${extra}<script type="application/json" id="__NUXT_DATA__" data-ssr="true">${devalue(payload)}</script></html>`;
const dia = (d) => { const t = new Date(Date.now() + d * 864e5).toISOString().slice(0, 10); return { date: `${t} 14:30:00.000000`, timezone: 'America/Fortaleza' }; };
const URL = 'https://www.e-leiloes.com.br/eventos/leilao/imovel-em-nuporanga-sp/lote/38390/dois-imoveis-residencial-area-de-240m-nuporanga-sp';
const lote = (p1, p2) => ({
  id: 38390, valorAvaliacao: 306135, valorMinimo: 0, valorInicial: 306135, valorInicial2: 183681,
  bem: { siteTitulo: 'Dois imóveis residencial, área de 240m² - Nuporanga/SP', cidade: 'Nuporanga', uf: 'SP', bairro: 'Jardim Estância II',
    endereco: 'Rua Maria de Lourdes Saltão de Barros', numero: '270', tipo: { nome: 'Casa' },
    siteDescricao: '<b>Matrícula nº 13.114 do CRI Local,</b> imóvel residencial urbano … encerrando a área de 240,00m².',
    arquivos: [{ url: 'https://static.e-leiloes.com.br/eleiloescombr/bens/24975/arquivos/a.jpg' }, { url: 'https://static.e-leiloes.com.br/eleiloescombr/bens/24975/arquivos/m.pdf' }] },
  leilao: { judicial: true, leiloeiro: { nome: 'Marilaine Borges de Paula' }, _urls: { edital: 'https://static.e-leiloes.com.br/ed.pdf' },
    documentos: [{ url: 'https://static.e-leiloes.com.br/ed.pdf' }], dataFimPraca1: p1, dataFimPraca2: p2, dataProximoLeilao: p2 },
});
const t = TENANTS.eleiloes;

// (1) 1ª praça já passou → vale a 2ª: data e mínimo dela, sem 2ª praça extra.
let det = parseDetalhe(pagina({ data: { 'lote-38390': lote(dia(-7), dia(14)), 'public-theme': {} } }), URL);
let r = montarRow(URL, det, t);
assert.equal(r.fonte_id, 'eleiloes_38390');
assert.equal(r.valor_avaliacao, 306135);
assert.equal(r.valor_minimo, 183681, 'na 2ª praça o mínimo é valorInicial2 (valorMinimo vem 0)');
assert.equal(r.data_leilao, dia(14).date.slice(0, 10));
assert.equal(r.data_leilao_2, null);
assert.equal(r.tipo, 'casa');
assert.equal(r.numero_matricula, '13.114');
assert.equal(r.leiloeiro, 'Marilaine Borges de Paula');
assert.equal(r.link_edital, 'https://static.e-leiloes.com.br/ed.pdf');
assert.deepEqual(r.fotos, ['https://static.e-leiloes.com.br/eleiloescombr/bens/24975/arquivos/a.jpg']);
assert.deepEqual(r.anexos.map(a => a.tipo), ['edital', 'documento']);

// (2) 1ª praça por vir → 1ª com valorInicial, 2ª praça com valorInicial2.
det = parseDetalhe(pagina({ data: { 'lote-38390': lote(dia(5), dia(25)) } }), URL);
r = montarRow(URL, det, t);
assert.equal(r.valor_minimo, 306135);
assert.equal(r.data_leilao, dia(5).date.slice(0, 10));
assert.ok(r.data_leilao_2?.startsWith(dia(25).date.slice(0, 10)));
assert.equal(r.valor_minimo_2, 183681);

// (3) JSON-LD OutOfStock = encerrado no site; página sem __NUXT_DATA__ = null (sem detalhe, não "encerrado").
const ld = '<script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/OutOfStock"}}</script>';
assert.equal(parseDetalhe(pagina({ data: { 'lote-38390': lote(dia(-30), dia(-10)) } }, ld), URL).encerrado, true);
assert.equal(parseDetalhe('<html>sem nuxt</html>', URL), null);

// (4) Listagem: só a chave da categoria (o "featured" mistura veículos).
const lista = { data: { 'leilao-categoria-imoveis--{}': { results: { total: 1, result: [{ _website: { canonicalUrl: URL } }] } },
  featured: [{ _website: { canonicalUrl: 'https://www.e-leiloes.com.br/eventos/leilao/x/lote/99999/carro' } }] } };
assert.deepEqual([...extrairUrlsDeLote(pagina(lista), t.base).keys()], ['38390']);

// (5) devalue: índice negativo (undefined) e referência repetida.
assert.deepEqual(decodificarNuxt([{ a: 1, b: 1, c: -1 }, 'x']), { a: 'x', b: 'x', c: null });

console.log('✓ eleiloes-praca-vigente: 2ª praça, 1ª+2ª, encerrado, listagem e devalue');
