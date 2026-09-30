// Busca por PARTE pelo DJEN (30/09): o DataJud público não tem partes; o DJEN varre todos os
// tribunais por nome. Destinatário precisa ter TODAS as palavras do nome (o DJEN devolve quem só
// compartilha o prenome); publicações do mesmo processo viram UM processo no formato de sempre.
import assert from 'node:assert/strict';
import { parteCasa, normalizarNomeParte, processosDasPublicacoes, separarPartes } from '../../api/_cnj.js';

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
assert.equal(p.tem_penhora, false, '"penhora" no TEXTO da intimação não é gravame (auditoria 30/09)');
assert.equal(p.cpf_no_texto, true, 'CPF informado aparece na publicação');
assert.equal(p.homonimo_possivel, false, 'CPF conferido: não é homônimo');
// Sem CPF conferido: pode ser homônimo — riscos não pesam.
const semDoc = processosDasPublicacoes([it('5000001-11.2024.4.03.6100', 'TRF3', '2026-09-01', 'x', [['MARCOS FERREIRA PINTO', 'P']], 'EMBARGOS À ARREMATAçãO')], { nome: 'Marcos Ferreira Pinto' });
assert.equal(semDoc[0].homonimo_possivel, true);
assert.deepEqual(semDoc[0].riscos, [], 'homônimo possível: riscos só indicados');
assert.ok(semDoc[0].riscos_indicados.some((r) => r.categoria === 'Embargos' && r.severidade === 'alerta'), 'classe indica embargos, no máximo alerta');
assert.equal(p.fase, 'Cumprimento de Sentença');
assert.deepEqual(p.partes.map((x) => x.nome), ['MARCOS FERREIRA PINTO', 'BANCO X']);
assert.deepEqual(separarPartes('ITALO SOARES DE ANDRADE e INGRID RAYANA MARCELINO DE SOUSA'), ['ITALO SOARES DE ANDRADE', 'INGRID RAYANA MARCELINO DE SOUSA']);
assert.deepEqual(separarPartes('RAIMUNDO CARNEIRO DE OLIVEIRA e JOSEMILDE CARNEIRO DE OLIVEIRA'), ['RAIMUNDO CARNEIRO DE OLIVEIRA', 'JOSEMILDE CARNEIRO DE OLIVEIRA']);
assert.deepEqual(separarPartes('TERMOPLAST INDUSTRIA E COMERCIO LTDA'), ['TERMOPLAST INDUSTRIA E COMERCIO LTDA'], 'empresa não é casal');
assert.deepEqual(separarPartes('ADAO PEREIRA E SILVA'), ['ADAO PEREIRA E SILVA'], '"e" dentro do nome da pessoa');
assert.deepEqual(separarPartes('MARIA SILVA, JOAO SOUZA'), ['MARIA SILVA', 'JOAO SOUZA']);
console.log('djen-busca-por-parte: todos os casos passaram');
