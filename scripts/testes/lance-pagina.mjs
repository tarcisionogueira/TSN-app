// npm run testar:lance-pagina — o acompanhamento de favoritos lê o lance certo, e não inventa
// "sem lance" quando a página simplesmente não mostra o lance.
import assert from 'node:assert/strict';
import { extrairLance } from '../../api/_lance-pagina.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const pad = (s) => `Lote 12 Apartamento 2 dormitórios Rua das Flores Centro Lance mínimo R$ 150.000,00 Avaliação R$ 300.000,00 ${s} `.padEnd(260, '.');

let r = extrairLance(pad('Lance atual: R$ 162.500,00 · 7 lances'));
assert.equal(r.estado, 'com_lance'); assert.equal(r.valor, 162500); assert.equal(r.qtdLances, 7);
ok('"Lance atual: R$ 162.500,00 · 7 lances" → com lance, valor e quantidade');

r = extrairLance(pad('Maior lance R$ 1.250.000,00'));
assert.equal(r.estado, 'com_lance'); assert.equal(r.valor, 1250000);
ok('"Maior lance" com milhar');

r = extrairLance(pad('Nenhum lance até o momento. Seja o primeiro a ofertar!'));
assert.equal(r.estado, 'sem_lance');
ok('"Nenhum lance" → sem lance');

r = extrairLance(pad('Lances: 0'));
assert.equal(r.estado, 'sem_lance');
ok('"Lances: 0" → sem lance');

r = extrairLance(pad('Faça seu cadastro para participar'));
assert.equal(r.estado, 'nao_medido'); assert.ok(r.motivo);
ok('página que não mostra o lance → NÃO MEDIDO com motivo (nunca "sem lance")');

r = extrairLance(pad('Lance mínimo R$ 99.000,00'));
assert.notEqual(r.estado, 'com_lance');
ok('"Lance mínimo" não é confundido com lance dado');

r = extrairLance('carregando...');
assert.equal(r.estado, 'nao_medido');
ok('página vazia (renderizada por script) → não medido');

r = extrairLance(pad('3 lances recebidos'));
assert.equal(r.estado, 'com_lance'); assert.equal(r.valor, null); assert.equal(r.qtdLances, 3);
ok('quantidade sem valor → com lance, valor desconhecido (dito no motivo)');

console.log(`\n✓ lance-pagina: ${n} casos`);
