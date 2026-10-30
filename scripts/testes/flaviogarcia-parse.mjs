// FLÁVIO GARCIA (flaviogarcia.lel.br, 30/10) — páginas reais (sem <script>/<style>):
//   home: 4 leilões; evento-206 (Unificado: veículo + 4 imóveis, arquivos "EDITAL LOTE 3 E 4"), 207 (Justiça Estadual),
//   208 (Venda Direta: 4 vagas de garagem em Pelotas), 209 (só um veículo SUSPENSO);
//   lote-1903: terreno com casa em Guaíba; 1905: "UM IMÓVEL" em Osório, sem foto; 1899: vaga de garagem (venda direta).
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, lerEvento, detalheDoLote, parseDetalhe, montarRow, checarQualidade, idDaUrl } from '../lib/flaviogarcia-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/flaviogarcia-${n}.html`, import.meta.url), 'utf8');
const B = 'https://www.flaviogarcia.lel.br';
const U1903 = `${B}/lote/um-terreno-e-uma-casa-de-madeira/1903`, U1905 = `${B}/lote/um-imovel/1905`, U1899 = `${B}/lote/vaga-de-estacionamento/1899`;
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.flaviogarcia;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

eq('home: 4 leilões', [...extrairUrlsDeEvento(ler('home')).keys()].sort(), ['206', '207', '208', '209']);
eq('evento 206: 4 imóveis (veículo 1897 fora pelo slug)', [...extrairUrlsDeLote(ler('evento-206')).keys()], ['1903', '1906', '1907', '1908']);
eq('evento 209: só veículo → nada', extrairUrlsDeLote(ler('evento-209')).size, 0);
eq('idDaUrl', idDaUrl(U1903), '1903');
const ev206 = lerEvento(ler('evento-206')), ev207 = lerEvento(ler('evento-207')), ev208 = lerEvento(ler('evento-208'));
eq('evento: nº do lote, selo e mínimo da 2ª praça', ev206.lotes.get('1903'), { numero: 2, selo: 'À VISTA', avaliacao: 80000, lanceMinimo: 64000 });
eq('evento 209: selo SUSPENSO', lerEvento(ler('evento-209')).lotes.get('1904').selo, 'SUSPENSO');

const d = detalheDoLote(ler('lote-1903'), U1903, { agora: HOJE, evento: ev206 });
const r = montarRow(U1903, d, T);
eq('1903: título, Guaíba/RS, casa', [r.titulo, r.cidade, r.estado, r.tipo], ['Um Terreno e Uma Casa de Madeira - Guaíba/RS', 'Guaíba', 'RS', 'casa']);
eq('1903: 1ª praça futura → mínimo = avaliação; fecha às 14h', [r.valor_avaliacao, r.valor_minimo, r.data_leilao, r.data_leilao_2],
  [80000, 80000, '2027-04-14T14:00:00-03:00', '2027-05-05T14:00:00-03:00']);
eq('1903: edital e matrícula do LOTE 2 (aba Arquivos do evento)', [r.link_edital, r.link_matricula, r.numero_matricula, r.area_m2],
  [`${B}/gerenciador/arquivos/leiloes/6e7a162334b2b03adc2019253ac8491b.pdf`, `${B}/gerenciador/arquivos/leiloes/0c015774cd723115008debe6ee30dbf1.pdf`, '17.517', 250]);
eq('1903: 3 fotos, judicial, aberto', [d.fotos.length, r.modalidade, d.encerrado], [3, 'judicial', false]);
const d2 = detalheDoLote(ler('lote-1903'), U1903, { agora: new Date('2027-04-20T12:00:00-03:00'), evento: ev206 });
eq('1903 após a 1ª praça: 2ª praça, mínimo do evento (80%)', [d2.data_leilao, d2.valor_minimo, d2.data_leilao_2], ['2027-05-05T14:00:00-03:00', 64000, null]);
eq('1903 após a 2ª praça: encerrado', detalheDoLote(ler('lote-1903'), U1903, { agora: new Date('2027-05-06T12:00:00-03:00'), evento: ev206 }).encerrado, true);

const r5 = montarRow(U1905, detalheDoLote(ler('lote-1905'), U1905, { agora: HOJE, evento: ev207 }), T);
eq('1905: "UM IMÓVEL" → 1ª oração do texto, Osório/RS', [r5.titulo, r5.cidade, r5.tipo], ['Um Terreno Urbano Situado na Praia de Atlântida Sul - Osório/RS', 'Osório', 'terreno']);
eq('1905: sem "ATÉ ÀS" → fecha 14h pela prorrogação das 13:57', [r5.data_leilao, r5.data_leilao_2], ['2026-12-01T14:00:00-03:00', '2026-12-08T14:00:00-03:00']);
eq('1905: matrícula 46.335 do LOTE 2, sem foto', [r5.numero_matricula, /3aa19413/.test(r5.link_matricula), r5.link_foto], ['46.335', true, null]);

const d9 = detalheDoLote(ler('lote-1899'), U1899, { agora: HOJE, evento: ev208 });
const r9 = montarRow(U1899, d9, T);
eq('1899: venda direta, mínimo do evento (50%), prazo final 01/03/2027 14h', [r9.modalidade, r9.valor_minimo, r9.data_leilao, r9.data_leilao_2], ['venda_direta', 6500, '2027-03-01T14:00:00-03:00', null]);
eq('1899: edital "LOTES 1,2,3 e 4 …" vale para o lote 1', r9.link_edital.includes('/gerenciador/arquivos/leiloes/'), true);
eq('1899: vaga de garagem sai pelo filtro de negócio', checarQualidade(r9, { estrito: false }).descartar, true);
eq('lote SUSPENSO no evento → encerrado', detalheDoLote(ler('lote-1903'), U1903, { agora: HOJE, evento: { lotes: new Map([['1903', { numero: 2, selo: 'SUSPENSO', lanceMinimo: 0 }]]), arquivos: [] } }).encerrado, true);
const semEv = detalheDoLote(ler('lote-1899'), U1899, { agora: HOJE });
eq('sem evento: mínimo cai na avaliação, sem edital', [semEv.valor_minimo, semEv.link_edital], [13000, U1899]);
eq('página sem lote → null', detalheDoLote('<body><h1>x</h1></body>', U1903), null);

// parseDetalhe busca o evento UMA vez e reaproveita (fetchFonte simulado).
let buscas = 0;
const fetchFonte = async (u) => { buscas++; return { html: /\/206$/.test(u) ? ler('evento-206') : null, via: 'fetch' }; };
const a = await parseDetalhe(ler('lote-1903'), U1903, { fetchFonte, agora: HOJE });
await parseDetalhe(ler('lote-1903'), U1903, { fetchFonte, agora: HOJE });
eq('parseDetalhe: evento lido 1× e usado', [buscas, a.link_matricula !== null], [1, true]);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ flaviogarcia-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
