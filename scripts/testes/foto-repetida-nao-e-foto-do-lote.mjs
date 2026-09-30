import assert from 'node:assert/strict';
import { anularFotoRepetida } from '../lib/dom-parse-util.mjs';

const G = 'https://x.s3.amazonaws.com/lotes/imagens/59135d.png';
const rows = [
  { titulo: 'SÍTIO ALVORADA, ITANAGRA/BA', link_foto: G },
  { titulo: 'TERRENO Nº 4, TIETÊ/SP', link_foto: G, fotos: [G, 'https://x/real4.jpg'] },
  { titulo: 'TERRENO Nº 3, TIETÊ/SP', link_foto: G },
  { titulo: 'APTO SALVADOR', link_foto: 'https://x/apto.jpg' },
  { titulo: 'CASA A', link_foto: 'https://x/par.jpg' },
  { titulo: 'CASA B', link_foto: 'https://x/par.jpg' },   // 2 lotes com a mesma foto: pode ser real
];
assert.equal(anularFotoRepetida(rows), 3);
assert.equal(rows[0].link_foto, null);
assert.equal(rows[1].link_foto, 'https://x/real4.jpg');
assert.deepEqual(rows[1].fotos, ['https://x/real4.jpg']);
assert.equal(rows[3].link_foto, 'https://x/apto.jpg');
assert.equal(rows[4].link_foto, 'https://x/par.jpg');
// O mesmo lote relido duas vezes (mesmo título) não conta como 2 lotes.
assert.equal(anularFotoRepetida([{ titulo: 'A', link_foto: G }, { titulo: 'A', link_foto: G }, { titulo: 'B', link_foto: G }]), 0);
console.log('foto-repetida: todos os casos passaram');
