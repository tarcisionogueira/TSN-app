// 08/11 (#305): com o cache frio a 1ª leitura estoura os 8 s e a 2ª passa. Repetir só o timeout, e só uma vez.
import assert from 'node:assert/strict';
import { repetirSeTimeout } from '../../api/_nova-tentativa.js';

const ehTimeout = (r) => r.error?.code === '57014';
const fila = (...respostas) => {
  let chamadas = 0;
  return { chamar: async () => respostas[Math.min(chamadas++, respostas.length - 1)], total: () => chamadas };
};
const timeout = { error: { code: '57014' } };

let f = fila({ data: 1 });
assert.deepEqual(await repetirSeTimeout(f.chamar, ehTimeout, 0), { data: 1 });
assert.equal(f.total(), 1, 'sucesso não repete');

f = fila(timeout, { data: 2 });
assert.deepEqual(await repetirSeTimeout(f.chamar, ehTimeout, 0), { data: 2 });
assert.equal(f.total(), 2, 'timeout repete');

f = fila(timeout, timeout, { data: 3 });
assert.deepEqual(await repetirSeTimeout(f.chamar, ehTimeout, 0), timeout, 'a segunda falha chega ao chamador');
assert.equal(f.total(), 2, 'repete uma vez só');

f = fila({ error: { code: '42P01' } }, { data: 4 });
assert.equal((await repetirSeTimeout(f.chamar, ehTimeout, 0)).error.code, '42P01');
assert.equal(f.total(), 1, 'outro erro não repete');

// Critério assíncrono, como o corpo de uma Response.
f = fila(timeout, { data: 5 });
assert.deepEqual(await repetirSeTimeout(f.chamar, async (r) => ehTimeout(r), 0), { data: 5 });
console.log('ok: timeout repete uma vez, e só timeout');
