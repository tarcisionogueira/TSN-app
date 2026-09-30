// Busca por PARTE pelo DJEN (30/09): o DataJud público não tem partes; o DJEN varre todos os
// tribunais por nome. Destinatário precisa ter TODAS as palavras do nome (o DJEN devolve quem só
// compartilha o prenome); publicações do mesmo processo viram UM processo no formato de sempre.
import assert from 'node:assert/strict';
import { parteCasa, normalizarNomeParte, processosDasPublicacoes } from '../../api/_cnj.js';

assert.equal(normalizarNomeParte('Marcos Ferreira Pintó'), 'MARCOS FERREIRA PINTO');
assert.equal(parteCasa('Marcos Ferreira Pinto', 'MARCOS FERREIRA PINTO'), true);
assert.equal(parteCasa('Marcos Ferreira Pinto', 'MARCOS ANTONIO FERREIRA PINTO'), true, 'nome do meio a mais ainda casa');
assert.equal(parteCasa('Marcos Ferreira Pinto', 'MARCOS GOMES BARBOSA'), false, 'só o prenome não basta');
assert.equal(parteCasa('Termoplast Indústria e Comércio Ltda', 'TERMOPLAST INDUSTRIA E COMERCIO LTDA'), true);

const it = (proc, trib, data, texto, dests, classe = 'CUMPRIMENTO DE SENTENçA') => ({
  numeroprocessocommascara: proc, siglaTribunal: trib, data_disponibilizacao: data, texto, nomeClasse: classe,
  nomeOrgao: '2ª Vara Cível', tipoComunicacao: 'Intimação', destinatarios: dests.map(([nome, polo]) => ({ nome, polo })),
});
const items = [
  it('1009291-28.2022.8.26.0554', 'TJSP', '2026-09-10', 'Defiro a penhora do imóvel. CPF 123.456.789-09', [['MARCOS FERREIRA PINTO', 'P'], ['BANCO X', 'A']]),
  it('1009291-28.2022.8.26.0554', 'TJSP', '2026-09-20', 'Designado leilão.', [['MARCOS FERREIRA PINTO', 'P']]),
  it('0000564-35.2018.5.11.0351', 'TRT11', '2026-08-01', 'Intime-se.', [['MARCOS GOMES BARBOSA', 'A']], 'AçãO TRABALHISTA'),
];
const ps = processosDasPublicacoes(items, { nome: 'Marcos Ferreira Pinto', documento: '12345678909' });
assert.equal(ps.length, 1, 'o homônimo parcial (MARCOS GOMES) fica fora');
const p = ps[0];
assert.equal(p.tribunal, 'TJSP');
assert.equal(p.publicacoes, 2);
assert.equal(p.ultima_atualizacao, '2026-09-20');
assert.equal(p.polo_da_parte, 'passivo');
assert.equal(p.tem_penhora, true);
assert.equal(p.cpf_no_texto, true, 'CPF informado aparece na publicação');
assert.equal(p.fase, 'Cumprimento de Sentença');
assert.deepEqual(p.partes.map((x) => x.nome), ['MARCOS FERREIRA PINTO', 'BANCO X']);
console.log('djen-busca-por-parte: todos os casos passaram');
