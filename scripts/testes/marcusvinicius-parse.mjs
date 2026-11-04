// MARCUS VINÍCIUS LEILÕES (marcusviniciusleiloes.com.br, 04/11) — páginas reais (sem <script>/<style>):
//   home: 17 leilões, 8 de imóvel (o resto é tear, telhas, tênis, moto, caminhão, piso…); leilao-748: lote de terreno
//   480 m² Ibituruna/Montes Claros (1 lote, item 3830); item-3830: "Em breve", R$ 324 mil nas duas praças, 03/12 e 18/12;
//   item-3801: Ubaí/MG, "1º leilão aberto", R$ 50 mil / R$ 25 mil, 12/11 e 27/11.
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, idDaUrl, ehImovel } from '../lib/marcusvinicius-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/marcusvinicius-${n}.html`, import.meta.url), 'utf8');
const HOJE = new Date('2026-11-04T12:00:00-03:00');
const T = TENANTS.marcusvinicius;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const eventos = extrairUrlsDeEvento(ler('home'));
eq('home → 8 leilões de imóvel de 17', eventos.size, 8);
eq('piso cerâmico (729, "200 m2") e tear (745) ficam de fora', [eventos.has('729'), eventos.has('745'), eventos.has('748')], [false, false, true]);
eq('"lote" de tênis não é imóvel', ehImovel('onze pares de tênis — lote'), false);

const lotes = extrairUrlsDeLote(ler('leilao-748'));
const U = [...lotes.values()][0];
eq('leilão 748 → item 3830', [lotes.size, idDaUrl(U)], [1, '3830']);

const d = parseDetalhe(ler('item-3830'), U, { agora: HOJE });
const r = montarRow(U, d, T);
eq('3830 título curto do leilão', r.titulo, 'Lote de terreno 480,00 M2, Ibituruna - Montes Claros - MG');
eq('3830 Montes Claros/MG, 480 m², matrícula 28.249', [r.cidade, r.estado, r.area_m2, r.numero_matricula], ['Montes Claros', 'MG', 480, '28.249']);
eq('3830 praças: 324 mil nas duas, término 03/12 e 18/12 às 14h', [d.valor_minimo, d.valor_minimo_2, r.data_leilao, r.data_leilao_2],
  [324000, 324000, '2026-12-03T14:00:00-03:00', '2026-12-18T14:00:00-03:00']);
eq('3830 judicial, edital PDF, sem avaliação inventada', [r.modalidade, /upload\/files\/.+\.pdf$/.test(r.link_edital), r.valor_avaliacao], ['judicial', true, 0]);
eq('3830 em breve = aberto', [d.encerrado, d.naoImovel, d.situacao], [false, false, 'Em breve']);
eq('3830 encerra depois da 2ª praça', parseDetalhe(ler('item-3830'), U, { agora: new Date('2026-12-19T12:00:00-03:00') }).encerrado, true);

const d2 = parseDetalhe(ler('item-3801'), 'https://www.marcusviniciusleiloes.com.br/item/3801/lote-01/x', { agora: HOJE });
eq('3801 Ubaí/MG, 50 mil → 25 mil, 1º leilão aberto', [d2.cidade, d2.valor_minimo, d2.valor_minimo_2, d2.situacao, d2.encerrado], ['Ubaí', 50000, 25000, '1º leilão aberto', false]);
eq('página sem lote → null', parseDetalhe(ler('leilao-748'), U, { agora: HOJE }), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ marcusvinicius-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
