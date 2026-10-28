// LEILO (leilo.com.br, 28/10) — estado SSR do app (`window.__INITIAL_STATE__`) do lote real 89bffde7 (Jataí/GO), reduzido
// a esse lote e a 4 leilões da lista; `new Date(...)` e `undefined` no literal, como o site serializa.
import fs from 'fs';
import { TENANTS, estadoDaPagina, extrairUrlsDeLote, extrairUrlsDeEvento, parseDetalhe, montarRow, cidadeDoNome } from '../lib/leilo-parse.mjs';
const T = TENANTS.leilo;
const html = fs.readFileSync(new URL('./fixtures/leilo-lote-89bffde7.html', import.meta.url), 'utf8');
const URL_LOTE = 'https://leilo.com.br/lote/89bffde7-ccc9-11f1-9fdb-0242ac5002a0/';
const ANTES = new Date('2026-10-28T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

eq('estado lido sem executar (new Date/undefined)', [!!estadoDaPagina(html), estadoDaPagina(html).hotsite.atualizado, estadoDaPagina(html).hotsite.vazio], [true, '2026-09-09T22:47:30.000Z', null]);
eq('lote de imóvel enumerado', [...extrairUrlsDeLote(html, T.base).values()], [URL_LOTE]);
eq('lote de veículo fica fora', extrairUrlsDeLote(html.replace('"tipo":"Imoveis"', '"tipo":"Veiculos"'), T.base).size, 0);
// Executados e a "Venda Direta" (já coberta pelo catálogo) não viram evento; o leilão aberto vira.
eq('eventos: só leilão aberto', extrairUrlsDeEvento(html, T.base).size, 0);
eq('eventos: leilão aberto entra', extrairUrlsDeEvento(html.replace('"situacao":"Executado"', '"situacao":"EmLoteamento"'), T.base).size, 1);

const d = parseDetalhe(html, URL_LOTE, { agora: ANTES });
const row = montarRow(URL_LOTE, d, T);
eq('cidade/UF pelo nome', [row.cidade, row.estado], ['Jatai', 'GO']);
eq('lances das 2 praças', [row.valor_minimo, row.valor_minimo_2, row.valor_avaliacao], [4130000, 3933406.64, 0]);
eq('praças', [row.data_leilao, row.data_leilao_2], ['2026-10-29T12:15:00.000Z', '2026-10-30T12:15:00.000Z']);
eq('aberto, matrícula e edital', [d.encerrado, /_CERTIDA.?O_ATUALIZADA\.pdf$/.test(row.link_matricula), /\.pdf$/.test(row.link_edital)], [false, true, true]);
eq('extrajudicial (cooperativa de crédito)', row.modalidade, 'extrajudicial');
// Entre as praças: o lance de agora é o da 2ª.
const d2 = parseDetalhe(html, URL_LOTE, { agora: new Date('2026-10-29T18:00:00-03:00') });
eq('1ª praça vencida → vale a 2ª', [d2.valor_minimo, d2.data_leilao, d2.data_leilao_2, d2.encerrado], [3933406.64, '2026-10-30T12:15:00.000Z', null, false]);
eq('depois da 2ª praça, encerrado', parseDetalhe(html, URL_LOTE, { agora: new Date('2026-11-01T12:00:00-03:00') }).encerrado, true);
eq('vendido sai', parseDetalhe(html.replace('"situacao":"LiberadoLeilao"', '"situacao":"Vendido"'), URL_LOTE, { agora: ANTES }).encerrado, true);
// DF é um município só: "Águas Claras/DF" é Brasília (bairro Águas Claras); cidade fora do IBGE não entra.
eq('DF → Brasília', cidadeDoNome('Águas Claras/DF - Apartamento com 102,5 m²'), { cidade: 'Brasília', estado: 'DF', bairro: 'Águas Claras' });
eq('cidade inexistente fica sem cidade', cidadeDoNome('Lugar Nenhum/GO - Terreno').cidade, null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ leilo-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
