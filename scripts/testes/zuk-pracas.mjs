/** npm run testar:zuk-pracas — 1ª/2ª praça da página ZUK (trechos reais do recon de 24/09). */
import { pracasZuk } from '../lib/zuk-pracas.mjs';
let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const a = pracasZuk('Encerra em 18/09/26 às 11h10 Data de encerramento Em 2º leilão pelo valor de R$ 451.200,00. Lance mínimo: 1º Leilão 16/09/26 às 11h10 R$ 752.000,00 2º Leilão 18/09/26 às 11h10 40 R$ 451.200,00 Este leilão já foi encerrado.');
ok(a.p1?.data === '2026-09-16' && a.p2?.ts === '2026-09-18T11:10:00-03:00', 'tabela de lances: 1ª 16/09 e 2ª 18/09 11h10 (a frase "Em 2º leilão pelo valor" não engana)');
const b = pracasZuk('O 1º Leilão ocorrerá às 24/09/26 às 13h00. Em caso de não haver licitantes, no dia 15/10/26 às 13h00 será realizado o 2º leilão deste lote pelo valor de R$ 89.905,26 Lance mínimo: 1º Leilão 24/09/26 às 13h00 R$ 149.842,10 2º Leilão 15/10/26 às 13h00 40 R$ 89.905,26');
ok(b.p1?.data === '2026-09-24' && b.p2?.data === '2026-10-15', 'Prestes Maia: 1ª 24/09 e 2ª 15/10');
ok(pracasZuk('Lance mínimo: Leilão Único 30/09/26 às 10h00 R$ 100.000,00').p2 === null, 'praça única: sem 2ª');
ok(pracasZuk('1º Leilão 20/09/26 às 10h00 2º Leilão 20/09/26 às 10h00').p2 === null, '2ª igual à 1ª: descartada');
// PRAÇA ÚNICA (08/10, #172) — texto REAL do lote 37810-236198 (recon-texto-pagina): sem 1º/2º
// Leilão, ano com 2 dígitos. 130 lotes do leilão 37810 estavam sem data por causa disto.
const u = pracasZuk('Relação completa do leilão Encerra em 06/10/26 às 11h13 Data de encerramento Em leilão pelo valor de R$ 230.300,00 Lance inicial: Data 06/10/26 às 11h13 53 R$ 230.300,00 Este leilão já foi encerrado.');
ok(u.p1?.ts === '2026-10-06T11:13:00-03:00' && u.p2 === null, 'praça única "Encerra em 06/10/26 às 11h13" → 1ª praça com hora');
ok(pracasZuk('Lance mínimo: Leilão Único 30/09/26 às 10h00 R$ 100.000,00').p1?.data === '2026-09-30', '"Leilão Único 30/09/26" → 1ª praça');
ok(a.p1?.data === '2026-09-16', 'com tabela de praças, o "Encerra em" não substitui a 1ª');
ok(pracasZuk('Veja também Casa Niquelândia Lance inicial R$ 326.080,00 50 14/10/2026 às 10:43').p1 === null, 'data solta da vitrine de outros lotes não vira praça');
console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
