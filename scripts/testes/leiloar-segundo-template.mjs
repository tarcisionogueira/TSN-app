// Plataforma Leiloar — 2º template (Bootstrap "responsivo") e o IPC (1º template com endereço no LOCAL), contra HTML
// REAL baixado pelo servidor do banco em 25/10 (#356). Fixtures: scripts/testes/fixtures/leiloar2-* e leiloar-ipc-*.
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, ehTeste } from '../lib/leiloar-parse.mjs';
import { naoEhImovel } from '../lib/dom-parse-util.mjs';

const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), 'utf8');
const AGORA = new Date('2026-10-25T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const linha = (fx, url, t) => { const det = parseDetalhe(F(fx), url, { agora: AGORA }); return { det, row: det && !det.encerrado ? montarRow(url, det, t) : null }; };
const pronto = (row) => !naoEhImovel(`${row.titulo} ${row.descricao}`, row.titulo) && !checarQualidade(row, { estrito: false }).descartar;

// ── Enumeração: teste/simulador/treinamento fora; raiz sem /externo; href absoluto do mesmo host ──
eq('IPC home: 7 leilões, o "SIMULADOR DE LEILÃO" fora', [...extrairUrlsDeEvento(F('leiloar-ipc-home'), TENANTS.ipc.base).keys()], ['463', '467', '466', '468', '465', '469', '471']);
const mbEv = extrairUrlsDeEvento(F('leiloar2-marques-home'), TENANTS.marquesbarreto.base);
eq('Marques Barreto home: "SIMULE SEUS LANCES AQUI" fora', [...mbEv.keys()], ['103', '104']);
eq('Marques Barreto home: lotes linkados direto na home', [...extrairUrlsDeLote(F('leiloar2-marques-home'), TENANTS.marquesbarreto.base).keys()], ['194', '195']);
const moEv = extrairUrlsDeEvento(F('leiloar2-moacira-home'), TENANTS.moacira.base);
eq('Moacira (raiz): leilão sem /externo', moEv.get('745'), 'https://www.moacira.lel.br/leilao/745');
const moLotes = extrairUrlsDeLote(F('leiloar2-moacira-home'), TENANTS.moacira.base);
eq('Moacira: href absoluto sem www vira o host do tenant', moLotes.get('11274'), 'https://www.moacira.lel.br/lote/11274/leilao-banco-de-brasilia-s-a-brb');
// (os 4 que sobram são o carrossel de destaques do topo, de OUTROS leilões — o mesmo da home)
eq('Moacira leilão 593 (TREINAMENTO): nenhum dos 11 "Bem #N (apenas para fins de treinamento)"',
  [...extrairUrlsDeLote(F('leiloar2-moacira-leilao-treinamento'), TENANTS.moacira.base).keys()].filter((id) => Number(id) < 7000), []);
eq('ehTeste', ['leilao-teste', 'leilao-simulador-de-leilao', 'leilao-simule-seus-lances-aqui', 'lote-teste-normal-em-brasilia', 'bem-2-apenas-para-em-aguas-lindas-de-goias', 'apartamento-304-bloco-20-do-em-brasilia'].map(ehTeste), [true, true, true, true, true, false]);

// ── Nasar judicial: "1º Leilão"/"2º Leilão" como rótulo de valor ──
const nJ = linha('leiloar2-nasar-lote-judicial', 'https://nasarleiloes.com.br/externo/lote/2015/01-uma-loja-comercial-no-em-fortaleza', TENANTS.nasar).row;
eq('Nasar judicial: título com cidade', nJ.titulo, 'Loja - Fortaleza/CE');
eq('Nasar judicial: avaliação = 1ª praça, 2ª praça separada', [nJ.valor_avaliacao, nJ.valor_minimo, nJ.valor_minimo_2], [86500, 86500, 43251]);
eq('Nasar judicial: data, modalidade, matrícula, área', [nJ.data_leilao, nJ.modalidade, nJ.numero_matricula, nJ.area_m2], ['2026-11-10T10:00:00-03:00', 'judicial', '61.689', 32]);
eq('Nasar judicial: foto e PDF absolutos', [nJ.link_foto, nJ.link_edital], ['https://nasarleiloes.com.br/arquivos/bem_foto/0071476001769711473.png', 'https://nasarleiloes.com.br/arquivos/arquivos_leilao/1769782472.pdf']);
eq('Nasar judicial: pronto', pronto(nJ), true);

// ── Nasar venda direta: LOCAL do leilão é "SÃO PAULO-SP", o lote é de Campinas (slug) ──
const nV = linha('leiloar2-nasar-lote-venda-direta', 'https://nasarleiloes.com.br/externo/lote/1912/imovel-monousuario-comercial-situado-na-em-campinas', TENANTS.nasar).row;
eq('Nasar venda direta: cidade do lote, não do leilão', [nV.cidade, nV.estado], ['Campinas', 'SP']);
eq('Nasar venda direta: tipo pelo texto ("Área do Terreno" não é terreno)', nV.titulo, 'Imóvel Comercial - Campinas/SP');
eq('Nasar venda direta: "Valor de Venda" = mínimo, sem avaliação inventada, sem data 2045', [nV.modalidade, nV.valor_avaliacao, nV.valor_minimo, nV.data_leilao], ['venda_direta', 0, 5332860, null]);
eq('Nasar venda direta: pronto', pronto(nV), true);

// ── Nasar moto na categoria "Imóveis Diversos" ──
eq('Nasar moto: não-imóvel', linha('leiloar2-nasar-lote-moto', 'https://nasarleiloes.com.br/externo/lote/1899/marca-honda-modelo-cg-em-fortaleza', TENANTS.nasar).det.naoImovel, true);

// ── Rodrigo: rótulo de valor VAZIO ("<b>: </b>R$ 193.000,00") ──
const r = linha('leiloar2-rodrigo-lote-sem-rotulo', 'https://rodrigoleiloes.com.br/externo/lote/118/apartamento-304-bloco-20-do-em-brasilia', TENANTS.rodrigo).row;
eq('Rodrigo: valores sem rótulo', [r.valor_avaliacao, r.valor_minimo, r.valor_minimo_2], [193000, 193000, null]);
eq('Rodrigo: Brasília com acento, matrícula, área', [r.titulo, r.numero_matricula, r.area_m2], ['Apartamento - Brasília/DF', '49.498', 45.11]);
eq('Rodrigo: pronto (fração ideal de condomínio não barra)', pronto(r), true);

// ── Moacira BRB: "Lance mínimo (avaliação)" / "(dívida)" e duas "Data" ──
const mo = linha('leiloar2-moacira-lote-brb', 'https://www.moacira.lel.br/lote/11274/leilao-banco-de-brasilia-s-a-brb', TENANTS.moacira).row;
eq('Moacira BRB: cidade de outro estado pelo LOCAL', mo.titulo, 'Casa - Teresópolis/RJ');
eq('Moacira BRB: avaliação e mínimos das duas praças', [mo.valor_avaliacao, mo.valor_minimo, mo.valor_minimo_2], [222000, 222000, 391736.42]);
eq('Moacira BRB: praças e modalidade', [mo.data_leilao, mo.data_leilao_2, mo.modalidade], ['2026-10-28T14:00:00-03:00', '2026-10-30T14:00:00-03:00', 'extrajudicial']);

// ── Marques Barreto: vaga de garagem sai pelo portão ──
const mb = linha('leiloar2-marques-lote-vaga', 'https://marquesbarretoleiloes.com.br/externo/lote/194/leilao-da-1a-vara-civel-de-samambaia-processo-n-0708587-34-2024-8-07-0009', TENANTS.marquesbarreto).row;
eq('Marques: vaga descartada', [mb.titulo, checarQualidade(mb, { estrito: false }).faltando], ['Vaga de Garagem - Brasília/DF', ['vaga_garagem']]);

// ── Lucas Ignacio: bem móvel ──
eq('Lucas: mesa de cabeceira não é imóvel', linha('leiloar2-lucas-lote-movel', 'https://lucasignacioleiloes.com.br/lote/145/1-uma-mesa-de-cabeceira-em-brasilia', TENANTS.lucasignacio).det.naoImovel, true);

// ── IPC (1º template): LOCAL com endereço, "Encerramento Nº Leilão", 2ª praça no texto do leilão ──
const ipc = linha('leiloar-ipc-lote-endereco', 'https://ipcleiloes.com.br/externo/lote/1278/imovel-devidamente-matriculado-sob-o-em-ponta-pora', TENANTS.ipc).row;
eq('IPC: cidade sem a rua', [ipc.cidade, ipc.estado], ['Ponta Porã', 'MS']);
eq('IPC: título', ipc.titulo, 'Casa - Manoel Padial Urel - Ponta Porã/MS');
eq('IPC: praças pelo encerramento', [ipc.data_leilao, ipc.data_leilao_2], ['2026-10-29T14:30:00-03:00', '2026-11-18T15:00:00-03:00']);
eq('IPC: avaliação, 2ª praça do texto, matrícula "matriculado sob o nº"', [ipc.valor_avaliacao, ipc.valor_minimo, ipc.valor_minimo_2, ipc.numero_matricula], [220000, 220000, 132000, '13.436']);
eq('IPC: pronto', pronto(ipc), true);
const fr = linha('leiloar-ipc-lote-fracao', 'https://ipcleiloes.com.br/externo/lote/1270/matricula-6-197-a-fracao-correspondente-em-anastacio', TENANTS.ipc).row;
eq('IPC: "A fração correspondente à 50%" sai como fração ideal', checarQualidade(fr, { estrito: false }).faltando, ['fracao_ideal']);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ leiloar 2º template: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
