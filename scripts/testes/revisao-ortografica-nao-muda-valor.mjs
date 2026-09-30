// A revisão ortográfica (api/revisar-texto.js) é SUGESTÃO e nunca pode mexer em valor, e-mail
// ou link — a trava na saída descarta a "correção" que alterou qualquer um deles.
import assert from 'node:assert/strict';
import { revisaoSegura } from '../../api/revisar-texto.js';

const orig = 'excelente dia! certo, fico no aguardo da devolutiva de vocês. proposta de 50% (R$ 12.500,00). link: https://www.superbid.net/oferta/4995864\natenciosamente, Tarcisio Nogueira.';
const bom  = 'Excelente dia! Certo, fico no aguardo da devolutiva de vocês. Proposta de 50% (R$ 12.500,00). Link: https://www.superbid.net/oferta/4995864\nAtenciosamente, Tarcisio Nogueira.';
assert.equal(revisaoSegura(orig, bom), null);
assert.match(revisaoSegura(orig, bom.replace('12.500,00', '12.000,00')), /descartada/);
assert.match(revisaoSegura(orig, bom.replace('4995864', '499586')), /descartada/);
assert.match(revisaoSegura(orig, 'Ok.'), /tamanho/);
assert.match(revisaoSegura(orig, ''), /vazia/);
console.log('5 ok');
