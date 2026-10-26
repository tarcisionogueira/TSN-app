// 26/10: sweep de fonte multi-tenant — o tenant que falhou não pode aposentar o próprio acervo (LEILOTECH perdeu
// 13 lotes vivos em 26/10; SUPORTE e HASTAPUBLICA tinham a mesma forma). Ver lib/sweep-trava.mjs.
import assert from 'node:assert/strict';
import { tenantParcial, likePrefixo, MAX_PROTEGIDOS } from '../lib/sweep-trava.mjs';

// Erro e paginação cortada protegem, mesmo com lote coletado.
assert.match(tenantParcial({ erro: 'Navigation timeout of 45000 ms exceeded', n: 0 }), /^erro/);
assert.match(tenantParcial({ n: 12, parcial: 'página 3 não abriu' }), /^parcial/);
// Vazio com lote ativo no banco: é o caso da Leilotech (interceptação do GraphQL vazia). Protege.
assert.equal(tenantParcial({ n: 0, ativosNoBanco: 4 }), 'vazio com 4 ativo(s) no banco');
// Vazio e banco ilegível: na dúvida, protege.
assert.match(tenantParcial({ n: 0, ativosNoBanco: null }), /ilegível/);
// Vazio sem nada no banco: não há o que proteger (catálogo vazio de verdade — tenant ligado vazio, regra do dono).
assert.equal(tenantParcial({ n: 0, ativosNoBanco: 0 }), null);
// Rodada sã: varre (o lote que saiu do site deste tenant sai do acervo).
assert.equal(tenantParcial({ n: 9, ativosNoBanco: 11 }), null);

// LIKE literal: o `_` do fonte_id não pode virar curinga.
assert.equal(likePrefixo('sl_bl_'), 'sl\\_bl\\_%');
assert.equal(likePrefixo('lt_topoleiloes_'), 'lt\\_topoleiloes\\_%');
assert.equal(likePrefixo('hastapublica_18567_'), 'hastapublica\\_18567\\_%');
assert.ok(MAX_PROTEGIDOS >= 20);
console.log('sweep-por-tenant: ok');
