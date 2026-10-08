// Plataforma Leiloar (Uberlândia Leilões) — contra HTML REAL capturado em 28/09 (fixtures/leiloar-*).
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade } from '../lib/leiloar-parse.mjs';
const T = TENANTS.uberlandia, F = (n) => fs.readFileSync(new URL(`./fixtures/leiloar-${n}.html`, import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

eq('home: 14 leilões', extrairUrlsDeEvento(F('home'), T.base).size, 14);
eq('leilão judicial: 3 lotes', [...extrairUrlsDeLote(F('leilao-judicial'), T.base).keys()], ['1507', '1508', '1509']);
eq('leilão extrajudicial: 1 lote', [...extrairUrlsDeLote(F('leilao-extrajudicial'), T.base).keys()], ['1523']);

const uJ = 'https://www.leiloesuberlandia.com.br/externo/lote/1507/descricao-do-imovel-1-um-em-uberlandia';
const j = montarRow(uJ, parseDetalhe(F('lote-judicial'), uJ), T);
eq('judicial: título', j.titulo, 'Apartamento - Tubalina - Uberlândia/MG');
eq('judicial: valores', [j.valor_avaliacao, j.valor_minimo, j.desconto_percentual], [254313.19, 127156.59, 50]);
eq('judicial: área privativa', j.area_m2, 50.44);
eq('judicial: praças (fim de cada hasta)', [j.data_leilao, j.data_leilao_2], ['2026-09-29T14:00:00-03:00', '2026-09-30T15:00:00-03:00']);
eq('judicial: modalidade/matrícula', [j.modalidade, j.numero_matricula], ['judicial', '119.451']);
eq('judicial: foto real, edital PDF', [!!j.link_foto && !/\.\.\//.test(j.link_foto), /\.pdf$/.test(j.link_edital)], [true, true]);
eq('judicial: passa na qualidade', checarQualidade(j, { estrito: false }).descartar, false);

const uE = 'https://www.leiloesuberlandia.com.br/externo/lote/1523/um-terreno-situado-nesta-cidade-em-uberlandia';
const e = montarRow(uE, parseDetalhe(F('lote-extrajudicial'), uE), T);
eq('extrajudicial: terreno (não "Casa" pelo nome do loteamento)', e.titulo, 'Terreno - Uberlândia/MG');
eq('extrajudicial: modalidade/área', [e.modalidade, e.area_m2], ['extrajudicial', 250]);
eq('extrajudicial: foto default.jpg = sem foto', e.link_foto, null);

// 08/10: bem móvel sem tipo reconhecido não pode ganhar "Imóvel" no título (12/19 ativos eram carro/moto/sofá).
const movel = (desc) => parseDetalhe(F('lote-judicial').replace(/(<div id="l-lote-descricao">[\s\S]*?<p>)[\s\S]*?(<\/p>)/i, `$1${desc}$2`), uJ).titulo;
eq('móvel: veículo vira "Bem"', movel('LOTE 1 - Veículo FIAT/PALIO FIRE, placa DFQ-5268, ano 2002/2003.').split(' - ')[0], 'Bem');
eq('móvel: sofá vira "Bem"', movel('BEM 1: Um sofá de veludo cor azul, estrutura em madeira maciça.').split(' - ')[0], 'Bem');
eq('sem tipo mas diz imóvel: "Imóvel"', movel('BEM: Um imóvel situado na Rua X, nº 10.').split(' - ')[0], 'Imóvel');

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
