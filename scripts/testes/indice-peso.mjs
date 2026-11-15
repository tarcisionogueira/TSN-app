// Peso da amostra pela prova + teto de 35% por origem + mediana ponderada (15/11, arena #484).
import assert from 'node:assert/strict';
import { aplicarPesos, medianaPonderada, pesoDaProva } from '../../api/_indice-peso.js';

assert.equal(pesoDaProva('conferido'), 1); assert.equal(pesoDaProva('sem_link'), 0.2); assert.equal(pesoDaProva('???'), 0.3);
// Mediana ponderada: sem peso = mediana simples; peso desloca para o lado pesado.
assert.equal(medianaPonderada([{ v: 1, p: 1 }, { v: 2, p: 1 }, { v: 3, p: 1 }]), 2);
assert.equal(medianaPonderada([{ v: 1, p: 1 }, { v: 2, p: 1 }]), 2);  // empate na metade: média arredondada (1,5→2)
assert.equal(medianaPonderada([{ v: 1000, p: 0.2 }, { v: 2000, p: 0.2 }, { v: 9000, p: 1 }]), 9000, 'o conferido pesa mais que dois sem link');
assert.equal(medianaPonderada([]), null);
// Teto: 8 amostras de um só portal + 1 de cada de outros 2 → o portal dominante cai a 35% do peso.
const am = [...Array(8).fill({ url: 'https://www.zap.com.br/imovel/1', prova: 'link_proprio' }),
  { url: 'https://a.com.br/imovel/2', prova: 'link_proprio' }, { url: 'https://b.com.br/imovel/3', prova: 'link_proprio' }];
const p = aplicarPesos(am);
const tot = p.reduce((s, a) => s + a.peso, 0);
const zap = p.filter((a) => a.origem === 'zap.com.br').reduce((s, a) => s + a.peso, 0);
assert.ok(zap / tot <= 0.3501, `zap ${(zap / tot).toFixed(3)} > 0.35`);
// Com só 2 origens o teto é impossível: pesos ficam os da prova.
assert.deepEqual(aplicarPesos([{ url: 'https://a.com/1', prova: 'conferido' }, { url: null, prova: 'sem_link' }]).map((a) => a.peso), [1, 0.2]);
// Não altera a entrada.
const entrada = [{ url: null, prova: 'sem_link' }]; aplicarPesos(entrada); assert.equal(entrada[0].peso, undefined);
console.log('indice-peso: ok');
