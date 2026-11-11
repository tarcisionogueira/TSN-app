// WR LEILÕES (wrleiloes.com.br, 11/11, pendência 469) — o site virou app React renderizado no navegador.
// Fixtures: HTML do Chromium (motor `dom`) de 11/11 — /leiloes (8 abertos + "Leilões anteriores"), o leilão do TRT11
// "IMOVEIS e MOVEIS" com os 25 lotes (depois do "Carregar mais"), o lote 1 (imóvel na Rua 24 de Maio, Manaus/AM) e o
// lote 2 (Chevrolet Prisma).
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl, lerLeilao, dataComFuso, cardEhImovel, cidadeDoBem } from '../lib/wrleiloes-parse.mjs';

const ler = (n) => fs.readFileSync(new URL(`./fixtures/wrleiloes-${n}.html`, import.meta.url), 'utf8');
const B = 'https://www.wrleiloes.com.br';
const AGORA = new Date('2026-11-11T12:00:00-03:00');
const T = TENANTS.wrleiloes;
const EVENTO = ler('evento-trt11');
const U_EVENTO = `${B}/leiloes/71015981-ba8b-4062-b0e7-fecb119a08cf`;
const fetchFonte = async (u) => (u === U_EVENTO ? { html: EVENTO, via: 'dom' } : { html: null, via: 'dom-404' });
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// 1. Leilões: só os abertos; DETRAN (só veículo) e "Leilões anteriores" fora
const evs = extrairUrlsDeEvento(ler('leiloes'));
eq('8 leilões abertos (2 DETRAN e os anteriores fora)', evs.size, 8);
eq('TRT11 está, com a url do leilão', evs.get('71015981-ba8b-4062-b0e7-fecb119a08cf'), U_EVENTO);
eq('DETRAN-AM (encerrado/veículos) fora', [...evs.keys()].some((k) => k.startsWith('cde472b3') || k.startsWith('0b98584f') || k.startsWith('189ded72')), false);

// 2. Lotes do leilão: 25 cards, 12 imóveis
const lotes = extrairUrlsDeLote(EVENTO);
eq('12 imóveis dos 25 lotes (veículo, móvel, barco, equipamento fora)', lotes.size, 12);
eq('lote 1 (imóvel) dentro, lote 2 (Prisma) fora', [lotes.has('a8013a79-0e60-422e-9f28-79f2fa0f7a9b'), lotes.has('cb074c02-4cae-4973-8423-cd6bb75003b1')], [true, false]);
eq('id da url é o uuid', idDaUrl(`${B}/lotes/a8013a79-0e60-422e-9f28-79f2fa0f7a9b`), 'a8013a79-0e60-422e-9f28-79f2fa0f7a9b');
eq('card: direitos aquisitivos de apto é imóvel', cardEhImovel('DIREITOS AQUISITIVOS | APTO 306 | SPLENDORE COMFORT RESIDENCE'), true);
eq('card: moto com ano/ano não é imóvel', cardEhImovel('HONDA NXR 160 BROS ESDD | 2022/2023 | PLACA RZB00B90'), false);
eq('card: áreas de terras é imóvel', cardEhImovel('02 ÁREAS DE TERRAS | MARAJÓ MIRI E SÃO SEBASTIÃO | IRANDUBA/AM'), true);

// 3. Cabeçalho do leilão
const L = lerLeilao(EVENTO);
eq('leilão: encerramento no fuso de Manaus, local, modalidade', [L.encerramento, L.local, L.modalidade, L.encerrado], ['2026-11-30T12:00:00-04:00', 'Manaus - AM', 'judicial', false]);
eq('leilão: edital em PDF', /\/documents\/auctions\/.+\.pdf$/.test(L.edital), true);
eq('fuso de Rio Branco', dataComFuso('05/12/2026, 10:00\nhorário de Rio Branco'), '2026-12-05T10:00:00-05:00');
eq('sem fuso dito, Brasília', dataComFuso('05/12/2026, 10:00'), '2026-12-05T10:00:00-03:00');

// 4. Lote imóvel
const uLote = `${B}/lotes/a8013a79-0e60-422e-9f28-79f2fa0f7a9b`;
const d = await parseDetalhe(ler('lote-imovel'), uLote, { fetchFonte, agora: AGORA });
eq('título', d.titulo, 'IMÓVEL | ÁREA DE 357,05M² | RUA 24 DE MAIO Nº 549 | CENTRO');
eq('cidade do corpo ("Manaus/AM")', [d.cidade, d.estado], ['Manaus', 'AM']);
eq('avaliação 800 mil, mínimo 320 mil', [d.valor_avaliacao, d.valor_minimo], [800000, 320000]);
eq('data = o DIA do encerramento (a hora diverge do edital)', d.data_leilao, '2026-11-30');
eq('área, matrícula, processo', [d.area_m2, d.numero_matricula, d.numero_processo], [357.05, '5.112', '0000103-95.2018.5.11.0017']);
eq('edital do leilão e 2 fotos', [/\.pdf$/.test(d.link_edital), d.anexos.length, d.fotos.length], [true, 1, 2]);
eq('judicial, aberto, imóvel', [d.modalidade, d.situacao, d.encerrado, d.naoImovel], ['judicial', 'Aberto para lances', false, false]);
eq('descrição sem o markdown (**)', /\*\*/.test(d.descricao), false);
const row = montarRow(uLote, d, T);
eq('fonte_id com o uuid', row.fonte_id, 'wrleiloes_a8013a79-0e60-422e-9f28-79f2fa0f7a9b');
eq('passa na qualidade', checarQualidade(row, { estrito: false }).ok, true);
eq('depois do encerramento (12h de Manaus = 13h de Brasília) → encerrado', (await parseDetalhe(ler('lote-imovel'), uLote, { fetchFonte, agora: new Date('2026-11-30T13:01:00-03:00') })).encerrado, true);
eq('antes dele, aberto', (await parseDetalhe(ler('lote-imovel'), uLote, { fetchFonte, agora: new Date('2026-11-30T12:59:00-03:00') })).encerrado, false);

// 5. Leilão que não abre: o lote segue (data e valores vêm da página do lote), só sem edital
const semLeilao = await parseDetalhe(ler('lote-imovel'), uLote, { fetchFonte: async () => ({ html: null, via: 'dom-falha' }), agora: AGORA });
eq('sem a página do leilão: lote lido, sem edital', [semLeilao.valor_minimo, semLeilao.data_leilao, semLeilao.link_edital], [320000, '2026-11-30', null]);

// 6. Veículo e casca vazia
eq('lote de veículo marcado como não imóvel', (await parseDetalhe(ler('lote-veiculo'), `${B}/lotes/cb074c02-4cae-4973-8423-cd6bb75003b1`, { fetchFonte, agora: AGORA })).naoImovel, true);
eq('casca do app sem título → null (não consegui ler)', await parseDetalhe('<html><body><div id="root"></div></body></html>', uLote, { fetchFonte }), null);

// 7. Cidade nas formas do leiloeiro
eq('"Boa Vista-RR"', cidadeDoBem('IMÓVEL | TERRENO 362 M² | RUA CARMELO | BOA VISTA-RR').cidade, 'Boa Vista');
eq('"município de Parintins, Estado do Amazonas"', cidadeDoBem('situado no município de Parintins, Estado do Amazonas').cidade, 'Parintins');

console.log(`wrleiloes-parse: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
