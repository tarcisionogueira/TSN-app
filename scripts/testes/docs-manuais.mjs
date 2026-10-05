// Lote manual (05/10): o texto dos anexos é guardado na análise e recomposto na regeração.
import assert from 'node:assert/strict';
import { ehLoteManual, docsManuaisSaneados, textosDosDocsManuais } from '../../api/_docs-manuais.js';

assert.equal(ehLoteManual('tsn_1791221725748_ga0bf'), true);
assert.equal(ehLoteManual('f8f87711-dab8-410d-bcde-63194b340ac9'), false);
assert.equal(ehLoteManual(''), false);

const docs = [
  { nome: 'matricula.pdf', tipo: 'matricula', texto: 'R-1 compra e venda', ext: { areaM2: 440.18 }, file: {}, lendo: false },
  { nome: 'laudo.pdf', tipo: 'outro', texto: 'laudo' },
  { nome: 'edital.pdf', tipo: 'edital', texto: 'x'.repeat(70000) },
  { nome: 'vazio.pdf', tipo: 'edital', texto: '' },
  { nome: 'hack', tipo: 'qualquer', texto: 't' },
];
const s = docsManuaisSaneados(docs);
assert.equal(s.length, 4, 'descarta o que não tem texto nem dados');
assert.equal(s[2].texto.length, 60000, 'teto por documento');
assert.equal(s[3].tipo, 'outro', 'tipo desconhecido vira outro');
assert.ok(!('file' in s[0]) && !('lendo' in s[0]), 'só campos conhecidos');
const t = textosDosDocsManuais(docs);
assert.ok(t.edital.startsWith('=== EDITAL: edital.pdf ==='), 'edital antes do complementar');
assert.ok(t.edital.includes('=== DOCUMENTO COMPLEMENTAR: laudo.pdf ==='));
assert.equal(t.matricula, '=== MATRÍCULA: matricula.pdf ===\nR-1 compra e venda');
assert.deepEqual(textosDosDocsManuais(null), { edital: '', matricula: '' });
console.log('ok docs-manuais');
