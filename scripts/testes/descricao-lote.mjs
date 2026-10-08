// Descrição do painel oficial do lote (ZUK/MEGA) — trechos do HTML real capturado em 08/10 via pg_net.
import fs from 'fs';
import { descricaoDoPainel } from '../lib/descricao-lote.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/descricao-${n}.html`, import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); p ? ok++ : falhas++; if (!p) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const mega = descricaoDoPainel('MEGA', F('mega'));
eq('MEGA: começa no texto do lote', mega?.slice(0, 31), 'Construção (Casa) residencial e');
eq('MEGA: traz matrícula e ocupação', [/76\.992/.test(mega), /Ocupada/.test(mega)], [true, true]);
eq('MEGA: entidades decodificadas', /“Parque Brasília”/.test(mega), true);
eq('MEGA: não invade a aba de pagamento', /À vista/.test(mega), false);

const zuk = descricaoDoPainel('ZUK', F('zuk'));
eq('ZUK: começa no texto do lote', zuk?.slice(0, 25), 'Apartamento n° 403, local');
eq('ZUK: inclui o trecho escondido (descricao-detalhes)', /31\.321/.test(zuk), true);
eq('ZUK: não pega a lista seguinte', /Veja também/.test(zuk), false);

eq('sem painel → null', descricaoDoPainel('ZUK', '<html><p>Casa bonita com 3 quartos e matrícula</p></html>'), null);
eq('fonte sem regra → null', descricaoDoPainel('GLOBOLEILOES', F('mega')), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
