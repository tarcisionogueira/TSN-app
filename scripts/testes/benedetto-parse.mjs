// BENEDETTO LEILÕES (benedettoleiloes.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   lista-imoveis: `/leiloes?category_id=1` (30 lotes, página única, finalizados inclusos);
//   2287: área de terras em São Leopoldo, judicial (TJRS), agendado 05/11 — config Vue com edital + matrícula;
//   2369: venda direta em andamento (Parobé), resumo "Imóvel localizado…" sem tipo; 2307: box de estacionamento (vaga);
//   1268: venda direta FINALIZADA em 2024 que a lista ainda mostra, cidade escrita "Tupandi-RS".
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl } from '../lib/benedetto-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/benedetto-${n}.html`, import.meta.url), 'utf8');
const U = (id) => `https://benedettoleiloes.com.br/lance/${id}`;
const HOJE = new Date('2026-10-30T16:00:00-03:00');
const T = TENANTS.benedetto;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lista = extrairUrlsDeLote(ler('lista-imoveis'));
eq('lista: 30 lotes de imóvel, url /lance/<id>', [lista.size, lista.get('2287'), idDaUrl(U(2287))], [30, U(2287), '2287']);

const d = parseDetalhe(ler('lote-2287'), U(2287), { agora: HOJE });
const r = montarRow(U(2287), d, T);
eq('2287 título do resumo, sem "Lote 1 -" nem avaliação', r.titulo, 'Área de terras, com 10.479,9461m², com frente para a Av. Mauá, São Leopoldo/RS');
eq('2287 cidade/UF, tipo, judicial', [r.cidade, r.estado, r.tipo, r.modalidade], ['São Leopoldo', 'RS', 'terreno', 'judicial']);
eq('2287 avaliação e lance do JSON, fim da janela', [r.valor_avaliacao, r.valor_minimo, r.data_leilao], [7550000, 7550000, '2026-11-05T15:00:00-03:00']);
eq('2287 área e matrícula', [r.area_m2, r.numero_matricula], [10479.9461, '58.128']);
eq('2287 edital e matrícula em PDF (barra dupla e espaços normalizados)',
  [r.link_edital, r.link_matricula],
  ['https://benedettoleiloes.com.br/storage/processos/2502/5027075-62.2023.8.21.0033%20%20ED.IMOV%20retificado.pdf', 'https://benedettoleiloes.com.br/storage/processos/58128.pdf']);
eq('2287 capa + 3 da galeria', [r.fotos.length, /\/storage\/lote\/2287\//.test(r.link_foto)], [4, true]);
eq('2287 aberto e imóvel', [d.encerrado, d.naoImovel, checarQualidade(r, { estrito: false }).descartar], [false, false, false]);

const d2 = parseDetalhe(ler('lote-2369'), U(2369), { agora: HOJE });
const r2 = montarRow(U(2369), d2, T);
eq('2369 venda direta em andamento, tipo vindo da descrição', [r2.modalidade, d2.encerrado, r2.tipo, r2.titulo],
  ['venda_direta', false, 'terreno', 'Terreno - Imóvel localizado próximo a rodovia RS239, na Rua Ervino Lehnen, Parobé/RS']);
eq('2369 valores e encerramento 26/11', [r2.valor_avaliacao, r2.valor_minimo, r2.data_leilao], [144260, 72130, '2026-11-26T15:00:00-03:00']);

const r3 = montarRow(U(2307), parseDetalhe(ler('lote-2307'), U(2307), { agora: HOJE }), T);
eq('2307 "O Box nº 44" → título começa em "Box" e cai na regra de vaga', [r3.titulo.slice(0, 10), checarQualidade(r3, { estrito: false }).faltando], ['Box nº 44 ', ['vaga_garagem']]);

const d4 = parseDetalhe(ler('lote-1268'), U(1268), { agora: HOJE });
eq('1268 FINALIZADO = encerrado; "Tupandi-RS" vira cidade', [d4.encerrado, d4.cidade, d4.estado], [true, 'Tupandi', 'RS']);

eq('encerrado pela situação do lote', parseDetalhe(ler('lote-2287').replace('&quot;status&quot;:&quot;DISPON\\u00cdVEL&quot;', '&quot;status&quot;:&quot;VENDIDO&quot;'), U(2287), { agora: HOJE }).encerrado, true);
eq('encerrado quando a janela passou', parseDetalhe(ler('lote-2287'), U(2287), { agora: new Date('2026-11-06T00:00:00-03:00') }).encerrado, true);
eq('categoria ≠ 1 → não-imóvel', parseDetalhe(ler('lote-2287').replace(/&quot;category_id&quot;:1,/g, '&quot;category_id&quot;:3,'), U(2287), { agora: HOJE }).naoImovel, true);
eq('página sem o config do lote → null', parseDetalhe('<body>Lote para Leilão</body>', U(1)), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ benedetto-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
