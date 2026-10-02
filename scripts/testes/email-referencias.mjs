/**
 * scripts/testes/email-referencias.mjs
 *
 * POR QUE EXISTE (02/10). O References das respostas da caixa ia como o JSON cru do array que o
 * Resend entrega — e a cada volta o fio aninhava mais uma camada (Leiloaria Smart, ~6 níveis,
 * com ids partidos). Tranca: (a) array vira "<a> <b>"; (b) JSON legado vira só os ids;
 * (c) lixo aninhado de verdade (forma do banco) devolve os ids válidos, sem fragmento partido;
 * (d) sem duplicados e com o id novo no fim; (e) corte mantém a raiz do fio; (f) vazio = null.
 */
import { referenciasNormalizadas, idsDeReferencia } from '../../api/_email-referencias.js';

let falhas = 0;
const ok = (cond, oque) => { if (cond) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

ok(referenciasNormalizadas(['<a@x.com>', '<b@y.com>']) === '<a@x.com> <b@y.com>', 'array → ids separados por espaço');
ok(referenciasNormalizadas('["<a@x.com>","<b@y.com>"]') === '<a@x.com> <b@y.com>', 'JSON legado → só os ids');

// Forma real gravada no banco (conversa Smart, 30/09): camadas de JSON escapado e ids partidos.
const lixo = String.raw`["<[\"<[\\\"<010301a0cf0f44d5-8993@sa-east-1.amazonses.com>\\\",\\\"<!&!AAAA=@leiloariasmart.com.br>\\\"]>\",\"<!&!BBBB=@>\",\"<leiloariasm>\",\"<ar>\",\"<t.com.br>\"]>","<!&!CCCC=@leiloariasmart.com.br>"]`;
const ids = idsDeReferencia(lixo);
ok(ids.includes('<010301a0cf0f44d5-8993@sa-east-1.amazonses.com>') && ids.includes('<!&!AAAA=@leiloariasmart.com.br>') && ids.includes('<!&!CCCC=@leiloariasmart.com.br>'), 'lixo aninhado → ids válidos recuperados');
ok(!ids.some(i => /leiloariasm>|<ar>|<t\.com\.br>|=@>/.test(i)), 'lixo aninhado → nenhum fragmento partido');
ok(!/[\[\]"\\]/.test(referenciasNormalizadas(lixo)), 'saída sem colchete, aspas ou barra');

ok(referenciasNormalizadas('<a@x.com> <b@y.com>', '<a@x.com>') === '<a@x.com> <b@y.com>', 'id já presente não duplica');
ok(referenciasNormalizadas('<a@x.com>', '<n@z.com>') === '<a@x.com> <n@z.com>', 'id novo entra no fim');
const muitos = Array.from({ length: 30 }, (_, i) => `<m${i}@x.com>`);
const cortado = referenciasNormalizadas(muitos).split(' ');
ok(cortado.length === 20 && cortado[0] === '<m0@x.com>' && cortado[19] === '<m29@x.com>', 'corte em 20 mantém a raiz e os mais recentes');
ok(referenciasNormalizadas(null) === null && referenciasNormalizadas('') === null, 'vazio → null');

console.log(falhas ? `\n${falhas} falha(s)` : '\nok');
process.exit(falhas ? 1 : 0);
