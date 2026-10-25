// Plataforma Labasoft (Schulmann, Karla Pepe, Leilões Braga — RJ) — contra HTML REAL baixado pelo servidor do banco
// em 25/10 (#356). Fixtures: scripts/testes/fixtures/labasoft-*.
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade } from '../lib/labasoft-parse.mjs';
import { naoEhImovel } from '../lib/dom-parse-util.mjs';

const F = (n) => fs.readFileSync(new URL(`./fixtures/${n}.html`, import.meta.url), 'utf8');
const AGORA = new Date('2026-10-25T12:00:00-03:00');
const S = TENANTS.schulmann, K = TENANTS.karlapepe;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const det = (fx, id, t) => parseDetalhe(F(fx), `${t.base}/detalhe.php?id=${id}`, { agora: AGORA, tenant: t });
const row = (fx, id, t) => montarRow(`${t.base}/detalhe.php?id=${id}`, det(fx, id, t), t);
const pronto = (r) => !naoEhImovel(`${r.titulo} ${r.descricao}`, r.titulo) && !checarQualidade(r, { estrito: false }).descartar;

// ── Enumeração ──
const ev = extrairUrlsDeEvento(F('labasoft-schulmann-home'), S.base);
eq('Schulmann: categorias sem a de veículos', [...ev.keys()].includes('leiloes-de-veiculos'), false);
eq('Schulmann: categoria de venda direta entra', ev.get('venda-direta'), 'https://www.schulmannleiloes.com.br/thumbs.php?tipo=venda-direta');
const lotes = extrairUrlsDeLote(F('labasoft-schulmann-home'), S.base);
eq('Schulmann: lotes da home, URL canônica do tenant (sem slug, com www)', [lotes.size >= 60, lotes.get('5831')], [true, 'https://www.schulmannleiloes.com.br/detalhe.php?id=5831']);

// ── Schulmann: salas no Centro (edital inline, avaliação no texto, cartório do Rio) ──
const s = row('labasoft-schulmann-salas', 4642, S);
eq('salas: título e cidade pelo cartório', s.titulo, 'Sala Comercial - Rio de Janeiro/RJ');
eq('salas: avaliação do edital, mínimo "A partir de" da praça aberta', [s.valor_avaliacao, s.valor_minimo], [201479.2, 100800]);
eq('salas: 1ª e 2ª praça (fim de cada uma)', [s.data_leilao, s.data_leilao_2], ['2026-11-18T14:00:00-03:00', '2026-12-01T14:00:00-03:00']);
eq('salas: foto grande da pasta do lote', s.link_foto, 'https://schulmannleiloes.com.br/upload/leilao/4642_P.jpg');
eq('salas: pronto', pronto(s), true);

// ── Schulmann: venda direta ("VENDA DIRETA - LOJA EM IPANEMA - Eletrônico - Judicial") ──
const v = row('labasoft-schulmann-venda-direta', 5831, S);
eq('venda direta: título não para no 1º " - "', v.titulo, 'Loja - Rio de Janeiro/RJ');
eq('venda direta: modalidade e valores', [v.modalidade, v.valor_avaliacao, v.valor_minimo], ['venda_direta', 480000, 480100]);
eq('venda direta: pronto', pronto(v), true);

// ── Schulmann: título que é a cidade ("ANGRA DOS REIS") ──
const a = row('labasoft-schulmann-angra', 3967, S);
eq('Angra: cidade pelo título, tipo pelo bem', a.titulo, 'Imóvel Rural - Angra dos Reis/RJ');
eq('Angra: valores', [a.valor_avaliacao, a.valor_minimo], [9300000, 4651000]);

// ── Karla Pepe: "Leilão Online Finalizado"; carro; Braga: teste da Labasoft ──
eq('Karla: finalizado = encerrado', det('labasoft-karla-finalizado', 110, K).encerrado, true);
const carro = det('labasoft-karla-carro', 111, K);
eq('Karla: carro aberto, mas não é imóvel', [carro.encerrado, carro.naoImovel, carro.valor_minimo, carro.valor_minimo_2], [false, true, 14000, 7000]);
eq('Braga: "Labasoft testando" fica fora', det('labasoft-braga-teste', 1, TENANTS.braga).teste, true);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ labasoft: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
