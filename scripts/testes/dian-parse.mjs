// LEILOEIRO DIAN (leiloeirodian.com.br, 29/10) — páginas reais, item RENDERIZADO no navegador (sem style/script/atributos):
//   home: 25 cards (10 imóveis, veículos e máquina ficam fora);
//   apto1206: leilão em 2ª praça (1ª 26/10, 2ª 09/11/2026), avaliação R$ 350 mil, matrículas no plural;
//   sergipe2195: VENDA DIRETA — o item não mostra preço; ele vem do card da home ("Valor de venda R$ 225.000,00").
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, parseDetalhe, montarRow, lerCard } from '../lib/dian-parse.mjs';
const T = TENANTS.dian;
const ler = (n) => fs.readFileSync(new URL(`./fixtures/dian-${n}.html`, import.meta.url), 'utf8');
const U = (id) => `${T.base}/item/${id}`;
const APTO = '5cfd6243-8e94-4be1-ba36-886bc56cae85', SERGIPE = '88e962c0-45ea-4ddb-b706-32969a3cb921';
const HOJE = new Date('2026-10-29T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// Enumeração: só categoria Imóvel; o card fica guardado para a venda direta.
const lotes = extrairUrlsDeLote(ler('home'), T.base);
eq('home: 10 imóveis entre 25 cards', lotes.size, 10);
eq('home: veículo não vira lote', lotes.has('b1d0aef8-72a7-462c-8e33-15cf1b12f1b4'), false);
eq('eventos: agenda e venda direta', [...extrairUrlsDeEvento('', T.base).values()], [`${T.base}/agenda`, `${T.base}/venda-direta`]);
eq('card de venda direta', (({ venda, cidade, categoria, valor }) => ({ venda, cidade, categoria, valor }))(lerCard('x', '<h3>T</h3><p>Vacaria<span> · <!-- -->Imóvel</span></p><div><span>Valor de venda</span><p>R$ 225.000,00</p></div><span>Venda direta</span>')),
  { venda: true, cidade: 'Vacaria', categoria: 'Imóvel', valor: 225000 });

// Apto 1206 — 2ª praça é a de agora
const d = parseDetalhe(ler('item-apto1206'), U(APTO), { agora: HOJE });
const r = montarRow(U(APTO), d, T);
eq('apto: cidade do endereço (IBGE)', [r.cidade, r.estado], ['Passo Fundo', 'RS']);
eq('apto: entre as praças vale a 2ª', [r.data_leilao, r.data_leilao_2, r.valor_minimo], ['2026-11-09T15:30:00-03:00', null, 175000]);
eq('apto: avaliação', r.valor_avaliacao, 350000);
eq('apto: antes da 1ª, duas praças', (({ data_leilao, data_leilao_2, valor_minimo, valor_minimo_2 }) => ({ data_leilao, data_leilao_2, valor_minimo, valor_minimo_2 }))(parseDetalhe(ler('item-apto1206'), U(APTO), { agora: new Date('2026-10-20T12:00:00-03:00') })),
  { data_leilao: '2026-10-26T15:30:00-03:00', data_leilao_2: '2026-11-09T15:30:00-03:00', valor_minimo: 350000, valor_minimo_2: 175000 });
eq('apto: matrícula no plural ("matrículas nº 115.305")', r.numero_matricula, '115.305');
eq('apto: judicial pelo nº do processo no edital', r.modalidade, 'judicial');
eq('apto: só as 2 fotos do lote (não as dos "semelhantes"), URL original do storage', r.fotos, [
  'https://qxmiokhkkbhsodbwsyly.supabase.co/storage/v1/object/public/auction_files/1789153002907_LT889.jpg',
  'https://qxmiokhkkbhsodbwsyly.supabase.co/storage/v1/object/public/auction_files/1789153002908_LT8892.jpg']);
eq('apto: edital em PDF', /Edital_de_Leiloes_5001480-91\.2020\.8\.21\.0057\.pdf$/.test(r.link_edital), true);
eq('apto: área', r.area_m2, 39.54);
eq('apto: aberto hoje, encerrado depois da 2ª', [d.encerrado, parseDetalhe(ler('item-apto1206'), U(APTO), { agora: new Date('2026-11-10T12:00:00-03:00') }).encerrado], [false, true]);

// Venda direta — preço do card
const dv = parseDetalhe(ler('item-sergipe2195'), U(SERGIPE), { agora: HOJE });
const rv = montarRow(U(SERGIPE), dv, T);
eq('venda: preço do card, avaliação da descrição', [rv.valor_minimo, rv.valor_avaliacao], [225000, 300000]);
eq('venda: sem data, modalidade venda_direta, nunca encerrado', [rv.data_leilao, rv.modalidade, dv.encerrado], [null, 'venda_direta', false]);
eq('venda: cidade, matrícula e 3 fotos', [rv.cidade, rv.numero_matricula, rv.fotos.length], ['Vacaria', '16.023', 3]);

// HTML CRU do DOM renderizado (classes, style, <svg><path>): o 1º seco no runner (29/10) enumerou 0 porque `<p[^>]*>`
// casava com `<path` e `<p>` não casava com `<p class="…">`.
const cru = extrairUrlsDeLote(`<main>${ler('card-cru')}</main>`, T.base);
eq('card cru (DOM renderizado) vira lote', [...cru.keys()], ['2567d6e5-873f-4180-a010-947521e2a8b1']);
eq('item cru: pares rótulo/valor com classe e ícone antes', (({ data_leilao, cidade }) => ({ data_leilao, cidade }))(parseDetalhe(
  '<main><svg><path d="M1 1"></path></svg><h1 class="t">CASA</h1><p class="e">Rua X, 1 — Vacaria/RS<span> · #A1</span></p>'
  + '<div class="g"><p class="r">Categoria</p><p class="v">Imóvel</p></div><div class="g"><p class="r">1ª praça</p><p class="v">05/11/2026, 14:30</p></div></main>',
  U('2567d6e5-873f-4180-a010-947521e2a8b1'), { agora: HOJE })), { data_leilao: '2026-11-05T14:30:00-03:00', cidade: 'Vacaria' });

// Sem card e sem praça: não entra.
eq('item sem praça e sem card → null', parseDetalhe(ler('item-sergipe2195'), U('00000000-0000-0000-0000-000000000000'), { agora: HOJE }), null);
eq('ainda carregando (sem h1) → null', parseDetalhe('<main>Carregando leilão...</main>', U(APTO)), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ dian-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
