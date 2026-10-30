// CRISTIANO ESCOLA LEILÕES (cristianoescolaleiloes.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   catalogo: `/categoria/imoveis` (50 cards, página única: 44 judiciais + 6 vendas diretas ENCERRADAS);
//   4976: casa em Vacaria, 1ª praça (lance sugerido = avaliação); 4841: apto em Porto Alegre já na 2ª praça;
//   4989: leilão de 3 lotes com "Valor de Avaliação" na descrição e 1ª praça abaixo dela; 4980: "Lance Atual" (já tem
//   lance); 3392: venda direta encerrada (sem painel de lance); 5040: conjunto de boxes (tipo só na tabela);
//   5005: o site põe a "2ª praça" (03/11) antes da 1ª (12/11).
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, cardsDoCatalogo, parseDetalhe, montarRow, checarQualidade, idDaUrl } from '../lib/cristianoescola-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/cristianoescola-${n}.html`, import.meta.url), 'utf8');
const HOJE = new Date('2026-10-30T16:00:00-03:00');
const T = TENANTS.cristianoescola;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lista = extrairUrlsDeLote(ler('catalogo'));   // também guarda as datas das praças para o parseDetalhe
const cards = cardsDoCatalogo(ler('catalogo'));
const U = (id) => lista.get(String(id));
eq('catálogo: 50 lotes, 6 encerrados no card', [lista.size, cards.filter((c) => c.encerrado).length], [50, 6]);
eq('id da url /ver-lote/<id>_<SLUG>', idDaUrl(U(4976)), '4976');
eq('card 4976: as duas praças', [cards.find((c) => c.id === '4976').d1, cards.find((c) => c.id === '4976').d2], ['2026-11-05T15:20:00-03:00', '2026-12-03T14:15:00-03:00']);

const d = parseDetalhe(ler('lote-4976'), U(4976), { agora: HOJE });
const r = montarRow(U(4976), d, T);
eq('4976 título sem "LOTE ÚNICO -", cidade da localização', [r.titulo, r.cidade, r.estado],
  ['Um Terreno Urbano, Com Área de 360,00m², e Uma Casa, Com Área Aproximada de 100m², em Vacaria/RS', 'Vacaria', 'RS']);
eq('4976 1ª praça: lance sugerido = avaliação; 2ª praça vem do catálogo', [r.valor_avaliacao, r.valor_minimo, r.data_leilao, r.data_leilao_2],
  [200000, 200000, '2026-11-05T15:20:00-03:00', '2026-12-03T14:15:00-03:00']);
eq('4976 judicial, aberto, matrícula 44.265', [r.modalidade, d.encerrado, r.numero_matricula], ['judicial', false, '44.265']);
eq('4976 edital, matrícula e foto original (sem /image/resize)', [r.link_edital, r.link_matricula, r.link_foto], [
  'https://www.cristianoescolaleiloes.com.br/userfiles/leiloes/170_edital2-1.pdf',
  'https://www.cristianoescolaleiloes.com.br/userfiles/lotes/120_matrimovel2.pdf',
  'https://www.cristianoescolaleiloes.com.br/userfiles/lotes/whatsapp_image_2026_08_28_at_151905.jpeg']);
eq('4976 passa na qualidade', checarQualidade(r, { estrito: false }).descartar, false);
eq('4976 sem o catálogo: só a praça corrente, nada inventado',
  [parseDetalhe(ler('lote-4976'), U(4976), { agora: HOJE, pracas: new Map() }).data_leilao_2, parseDetalhe(ler('lote-4976'), U(4976), { agora: HOJE, pracas: new Map() }).data_leilao],
  [null, '2026-11-05T15:20:00-03:00']);

const d2 = parseDetalhe(ler('lote-4841'), U(4841), { agora: HOJE });
eq('4841 na 2ª praça: data corrente = 2ª, 1ª do catálogo; avaliação desconhecida', [d2.situacao, d2.data_leilao, d2.data_leilao_2, d2.valor_minimo, d2.valor_avaliacao, d2.cidade],
  ['Segundo Leilão', '2026-10-08T15:18:00-03:00', '2026-11-05T14:20:00-03:00', 45000, 0, 'Porto Alegre']);
eq('4841 aberto até 05/11', [d2.encerrado, parseDetalhe(ler('lote-4841'), U(4841), { agora: new Date('2026-11-06T00:00:00-03:00') }).encerrado], [false, true]);

const d3 = parseDetalhe(ler('lote-4989'), U(4989), { agora: HOJE });
eq('4989 "Valor de Avaliação" da descrição vence o lance da 1ª praça', [d3.valor_avaliacao, d3.valor_minimo], [667000, 343000]);

eq('4980 "Lance Atual" (strong#last_offer) é lido; avaliação não é inventada', [parseDetalhe(ler('lote-4980'), U(4980), { agora: HOJE }).valor_minimo, parseDetalhe(ler('lote-4980'), U(4980), { agora: HOJE }).valor_avaliacao], [234000, 0]);

const d5 = parseDetalhe(ler('lote-3392'), U(3392), { agora: HOJE });
eq('3392 venda direta sem painel de lance = encerrada', [d5.modalidade, d5.encerrado, d5.valor_minimo], ['venda_direta', true, 0]);

const r6 = montarRow(U(5040), parseDetalhe(ler('lote-5040'), U(5040), { agora: HOJE }), T);
eq('5040 "A totalidade dos bens…" com tipo Box/Vaga → regra de vaga', [r6.titulo.slice(0, 20), checarQualidade(r6, { estrito: false }).faltando], ['Box/Vaga de Garagem ', ['vaga_garagem']]);

const d7 = parseDetalhe(ler('lote-5005'), U(5005), { agora: HOJE });
eq('5005 "2ª praça" antes da 1ª (erro do site) é descartada', [d7.data_leilao, d7.data_leilao_2, d7.encerrado], ['2026-11-12T14:15:00-03:00', null, false]);

eq('página sem h1 do lote → null', parseDetalhe('<body><h1>Lotes</h1></body>', U(4976)), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ cristianoescola-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
