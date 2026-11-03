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

// 03/11 — o lote inteiro pela página fixa (o painel não renderizou em 88 de 180 leilões em 02/11).
const l1 = um.lotes.get('1');
eq('18524: valor da praça VIGENTE (o par 1ª/2ª comentado é ignorado)', l1.valorTxt, '388.750,00');
eq('18524: status, data do lote e Cidade/UF do cartão', [l1.status, l1.dataLote, l1.cidadeUf], ['Ativo', '2026-10-29T14:30:00-03:00', 'Barueri/SP']);
eq('18524: título do lote', l1.titulo.length > 10 && !/<|Barueri\/SP<br/.test(l1.titulo), true);
eq('18524: cabeçalho judicial + encerramento das duas praças', [um.judicial, um.praca1, um.praca2], [true, '2026-10-29T14:30:00-03:00', '2026-11-18T14:30:00-03:00']);
eq('18232: praça única vira praca1, sem praca2', [v.praca1, v.praca2], ['2026-10-02T17:00:00-03:00', undefined]);
eq('18232: vara e Cidade/UF do leilão pelo cabeçalho', [v.varaComarca, v.cidadeLeilao, v.ufLeilao], ['Alienação Particular - TRT 15ª Região de Araraquara/SP', 'Araraquara', 'SP']);
eq('18232: lote 2 — valor da praça única e título próprio', [v.lotes.get('2').valorTxt, /lote 10/.test(v.lotes.get('2').titulo)], ['39.000,00', true]);
eq('18494: Cidade/UF fora do padrão chega crua (quem decide é o coletor)', s.lotes.get('1').cidadeUf, 'BRASÍLIA-DF /DF');

console.log(`${falhas ? '✗' : '✓'} hastapublica-parse: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
