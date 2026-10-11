import assert from 'node:assert/strict';
import { matriculaDoTexto } from '../lib/matricula-texto.mjs';
const casos = [
  ['Matrícula atualizada em 22/10/2020 ... Matrícula nº 15603, RI - Pratápolis/MG', '15603'],
  ['Matrícula 27/12/2024', null],
  ['Imóvel objeto da matrícula nº 2026 do CRI', '2026'],
  ['matrícula atualizada em 2026', null],
  ['Matrícula: 118.873', '118.873'],
  ['Matrícula Imobiliária nº 42016 do 1º RI', '42016'],
  ['matrícula sob o nº 7210', '7210'],
];
for (const [t, esp] of casos) assert.equal(matriculaDoTexto(t), esp, t);
assert.equal(matriculaDoTexto('Matrícula 22/10/2020', 'Matrícula nº 15603'), '15603');
console.log('ok matricula-do-texto', casos.length + 1);
