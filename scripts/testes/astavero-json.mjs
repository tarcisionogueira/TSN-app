// ASTAVERO (05/10, #41): listagem + /app/pregao/init → linha do acervo. JSON REAL (Damiani, lote 01.1).
import assert from 'node:assert/strict';
import { montarRowAstavero, localDaListagem, TENANTS } from '../lib/astavero-json.mjs';

const tenant = TENANTS.find((t) => t.fonte === 'DAMIANILEILOES');
const item = { id: '6a738d676890635e0b8f4a12', url: 'https://damianileiloes.com.br/pregao/6a738d127044d059a66148a8/6a738d676890635e0b8f4a12',
  data: '2026-10-06T17:00:00.000Z', lote: '01.1', nome: 'Imóvel em Rio do Meio - Grão-Pará', vara: '1ª Vara Da Comarca de Orleans', image: '',
  local: 'Grão Pará - SC', praca: 1, valor: 215958.01, leilao: '6a738d127044d059a66148a8', origem: 'Estadual', status: 'Aberto', avaliacao: 215958.01 };
const det = {
  leilao: { datas: { d1: '2026-10-06T17:00:00.000Z', d2: '2026-10-13T17:00:00.000Z' }, anexos: [{ arquivo: 'edital_63_26-1785957935000.pdf', private: false,
    url: 'https://objectstorage.sa-saopaulo-1.oraclecloud.com/n/grlkbn1ggqso/b/astavero/o/anexos/damiani/6a738d127044d059a66148a8/6a738d127044d059a66148a8/edital_63_26-1785957935000.pdf' }] },
  lote: { v: { avaliacao: 215958.01, primeira: 215958.01, segunda: 110138.58510000001 },
    p: { processo: '5002636-33.2024.8.24.0044', vara: '1ª Vara Da Comarca de Orleans', tipo: 'Execução de Título Extrajudicial', falencia: false },
    d: { uf: 'SC', cidade: 'Grão Pará', bairro: '', endereco: 'localidade de Rio do Meio Alto/Ivernada, município de Grão-Pará (SC)', cep: '' },
    status: 'Aberto', nome: 'Imóvel em Rio do Meio - Grão-Pará',
    detalhada: '<p style="text-align: justify;">01.1) 01 (um) terreno rural, matriculado sob o nº 20.512, no Ofício do Registro de Imóveis da Comarca de Braço do Norte (SC), situado na localidade de Rio do Meio Alto/Ivernada, município de Grão-Pará (SC), com área de 69.000,00 m² (sessenta e nove mil metros quadrados)</p>' },
};
const r = montarRowAstavero(item, det, tenant);
assert.equal(r.fonte_id, 'damianileiloes_6a738d676890635e0b8f4a12');
assert.deepEqual([r.cidade, r.estado], ['Grão Pará', 'SC']);
assert.equal(r.valor_minimo, 215958.01);
assert.equal(r.valor_minimo_2, 110138.59);                          // 2ª praça, arredondada ao centavo
assert.equal(r.data_leilao_2, '2026-10-13T17:00:00.000Z');
assert.equal(r.modalidade, 'judicial');                             // "Execução de Título Extrajudicial" é processo JUDICIAL
assert.equal(r.numero_processo, '5002636-33.2024.8.24.0044');
assert.equal(r.numero_matricula, '20512');
assert.equal(r.area_m2, 69000);
assert.equal(r.tipo, 'rural');
assert.match(r.link_edital, /edital_63_26/);
assert.equal(r.link_foto, undefined);                               // imagem vazia não vira foto
assert.equal(r.desconto_percentual, 0);

// Sem detalhe (POST falhou): entra com o que a listagem tem, nada inventado.
const so = montarRowAstavero({ ...item, praca: 2, valor: 110138.59 }, null, tenant);
assert.deepEqual([so.cidade, so.estado, so.valor_minimo, so.valor_minimo_2], ['Grão Pará', 'SC', 110138.59, null]);
assert.deepEqual(localDaListagem('Manhuaçu - MG'), { cidade: 'Manhuaçu', estado: 'MG' });
// 2ª praça corrente: a data é a dela, não a d1 que já passou (Mazzolli, apto 502 do Res. Ilha de Bali — dado real).
const apto = montarRowAstavero({ ...item, praca: 2, valor: 112500 }, {
  leilao: { datas: { d1: '2026-10-01T21:30:00.000Z', d2: null } },
  lote: { v: { avaliacao: 225000, primeira: 225000, segunda: 112500 }, p: { processo: '5045442-38.2023.8.24.0038' }, d: { uf: 'SC', cidade: 'Joinville' },
    datas: { leilao: '2026-10-08T18:30:00.000Z', inicial: '2026-10-01T21:30:00.000Z' }, nome: 'Apartamento - Res. ilha de Bali',
    detalhada: '<p>01 (um) apartamento n. 502, com área privativa de 59,74000m², área comum de 7,11337500m², área total de 66,85337500m²</p>' },
}, tenant);
assert.equal(apto.data_leilao, '2026-10-08T18:30:00.000Z');
assert.equal(apto.valor_minimo, 112500);
assert.ok(apto.area_m2 > 50 && apto.area_m2 < 70, `área de apartamento plausível, veio ${apto.area_m2}`);
console.log('astavero-json: todos os casos passaram');
