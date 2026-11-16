// #410 (16/11): a lacuna por ID conta só o que o site lista e o banco não tem — e falha de leitura não vira "0".
import assert from 'node:assert/strict';
import { contarForaDoAcervo } from '../_saude-fonte.mjs';

const banco = ({ acervo = [], recusados = [], erroEm = null }) => ({
  from: (t) => ({ select: () => ({ in: async (_c, ids) => {
    if (erroEm === t) return { data: null, error: { message: 'timeout' } };
    const fonte = t === 'imoveis_leilao' ? acervo.map(fonte_id => ({ fonte_id })) : recusados;
    return { data: fonte.filter(r => ids.includes(r.fonte_id)), error: null };
  } }) }),
});

const ids = new Set(['a', 'b', 'c', 'd', 'e']);
// a e b no acervo (ativo ou inativo, tanto faz); c recusado como não-imóvel; d descartado por VALOR (segue faltando); e nunca visto.
const sb = banco({ acervo: ['a', 'b'], recusados: [{ fonte_id: 'c', motivo: 'nao_imovel' }, { fonte_id: 'd', motivo: 'descartado: valor ausente' }] });
assert.equal(await contarForaDoAcervo(sb, ids, { descontarRecusados: true }), 2);
assert.equal(await contarForaDoAcervo(sb, ids), 3, 'sem descontar recusados (SOLEON não grava recusa)');
assert.equal(await contarForaDoAcervo(banco({ acervo: [...ids] }), ids), 0);
// Leitura que falha: null (sem medida), nunca 0.
assert.equal(await contarForaDoAcervo(banco({ erroEm: 'imoveis_leilao' }), ids), null);
assert.equal(await contarForaDoAcervo(banco({ erroEm: 'coleta_lote_recusado' }), ids, { descontarRecusados: true }), null);
assert.equal(await contarForaDoAcervo(sb, new Set()), null, 'sem lista não há medida');
console.log('ok — lacuna por id: acervo e recusa contam como vistos, descarte por valor e nunca-visto como falta, erro = null');
