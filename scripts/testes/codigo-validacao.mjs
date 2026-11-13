// npm run testar:codigo-validacao — o código impresso no rodapé dos documentos assinados é lido de volta
// do jeito que a pessoa digitar, e caractere ambíguo (I, O, 0, 1) nunca vale.
import assert from 'node:assert/strict';
import { ALFABETO_CODIGO, normalizarCodigo, formatarCodigo, mascararDocumento } from '../../src/lib/codigo-validacao.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };

assert.equal(ALFABETO_CODIGO.length, 32); ok('alfabeto de 32 símbolos (5 bits cada, 80 bits no código)');
assert.equal(new Set(ALFABETO_CODIGO).size, 32); ok('sem símbolo repetido');
for (const c of 'IO01') assert.ok(!ALFABETO_CODIGO.includes(c)); ok('sem I, O, 0 e 1');
assert.equal(normalizarCodigo('abcd-efgh-jklm-npqr'), 'ABCDEFGHJKLMNPQR'); ok('aceita minúsculas e hífens');
assert.equal(normalizarCodigo(' ABCD EFGH JKLM NPQR '), 'ABCDEFGHJKLMNPQR'); ok('aceita espaços');
assert.equal(normalizarCodigo('ABCD-EFGH-1KLM-NPQR'), null); ok('caractere fora do alfabeto é recusado');
assert.equal(normalizarCodigo('ABCDEFGH'), null); ok('curto demais é recusado');
assert.equal(normalizarCodigo(null), null); ok('vazio é recusado');
assert.equal(formatarCodigo('ABCDEFGHJKLMNPQR'), 'ABCD-EFGH-JKLM-NPQR'); ok('impresso em 4 grupos');
assert.equal(mascararDocumento('529.982.247-25'), '529.***.***-25'); ok('CPF mascarado');
assert.equal(mascararDocumento('11222333000181'), '11.***.***/****-81'); ok('CNPJ mascarado');
assert.equal(mascararDocumento('123'), null); ok('documento incompleto não aparece');
console.log(`\n${n} verificações OK`);
