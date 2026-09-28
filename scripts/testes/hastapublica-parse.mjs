// HastaPública — página estática do leilão, contra HTML REAL capturado em 28/09 (fixtures/hastapublica-*).
import fs from 'fs';
import { parseLeilaoHasta } from '../lib/hastapublica-parse.mjs';
const F = (n) => fs.readFileSync(new URL(`./fixtures/hastapublica-leilao-${n}.html`, import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const um = parseLeilaoHasta(F('1lote'));
eq('18524: leiloeiro é a pessoa, não a vara', um.leiloeiro, 'Euclides Maraschi Junior');
eq('18524: lote 1 com a foto do CDN (não o logo do TJSP)', um.lotes.get('1')?.foto, 'https://s3-sa-east-1.amazonaws.com/cdnhp/content/61fb97c1627c763e9f7d1873d28822f2.jpg');
eq('18524: link do lote', /\/lote\/104791\//.test(um.lotes.get('1')?.urlLote || ''), true);

const v = parseLeilaoHasta(F('varios'));
eq('18232: 4 lotes, numerados', [...v.lotes.keys()], ['1', '2', '3', '4']);
eq('18232: cada lote com foto própria (nenhuma repetida)', new Set([...v.lotes.values()].map((l) => l.foto)).size, 4);
eq('18232: lote 1 = foto e link do Peruíbe', [v.lotes.get('1').foto.endsWith('bf377d4d3db5800d1aeaa0eab45a8657.jpg'), /\/lote\/104242\//.test(v.lotes.get('1').urlLote)], [true, true]);

const s = parseLeilaoHasta(F('sem-foto'));
eq('18494: nopicfull.png NÃO vira foto', s.lotes.get('1')?.foto, null);
eq('18494: leiloeiro', s.leiloeiro, 'Silvia Barros');
eq('HTML vazio não quebra', parseLeilaoHasta('').lotes.size, 0);

console.log(`${falhas ? '✗' : '✓'} hastapublica-parse: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
