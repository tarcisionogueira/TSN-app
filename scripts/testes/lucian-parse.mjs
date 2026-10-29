// LUCIAN (lucianleiloes.com.br, 28/10) — duas páginas reais de lote, uma por template:
//   804: bloco de praças ("1° Leilão: … R$ 120.000,00 / 2° Leilão: … R$ 60.000,00"), botão "Encerrado", edital+matrícula;
//   827: pregão "Lote 01…16" — datas só nos inputs ocultos, valores escritos nas Observações, "ABERTO PARA LANCES".
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, parseDetalhe, montarRow, cidadeDoTexto } from '../lib/lucian-parse.mjs';
const T = TENANTS.lucian;
const ler = (n) => fs.readFileSync(new URL(`./fixtures/lucian-lote-${n}.html`, import.meta.url), 'utf8');
const U804 = 'https://lucianleiloes.com.br/categoria/6/imoveis/leilao/804/01-um-imovel-residencial-n-09-da-quadra-1-438-farroupilha-rs';
const U827 = 'https://lucianleiloes.com.br/categoria/6/imoveis/leilao/827/lote-05-01-um-imovel-terreno-urbano-na-cidade-de-osorio-rs';
const ANTES = new Date('2026-10-01T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const home = '<a class="btn card-link" href="categoria/6/imoveis/leilao/848/01-um-lote-urbano">x</a>'
  + '<a href="categoria/7/veiculos/leilao/847/01-um-m-benz">y</a><a href="/agenda/leiloes/data/2026-11-04/1">z</a>';
eq('só categoria 6 (imóveis) vira lote', [...extrairUrlsDeLote(home, T.base).values()], ['https://lucianleiloes.com.br/categoria/6/imoveis/leilao/848/01-um-lote-urbano']);
eq('agenda vira evento', [...extrairUrlsDeEvento(home, T.base).values()], ['https://lucianleiloes.com.br/agenda/leiloes/data/2026-11-04/1']);

// 804 — 1º template, antes da 1ª praça
const d = parseDetalhe(ler('804'), U804, { agora: ANTES });
const r = montarRow(U804, d, T);
eq('804 tipo no título, sem "Imóveis"', /^Casa - 01 \(um\) Imóvel Residencial/.test(r.titulo), true);
eq('804 cidade pelo título (IBGE)', [r.cidade, r.estado], ['Farroupilha', 'RS']);
eq('804 praças e valores', [r.valor_avaliacao, r.valor_minimo, r.valor_minimo_2, r.data_leilao, r.data_leilao_2],
  [120000, 120000, 60000, '2026-10-08T10:30:00-03:00', '2026-10-22T10:30:00-03:00']);
eq('804 edital e matrícula', [/edital_\d+_5000640/.test(r.link_edital), /matricula_\d+\.pdf$/.test(r.link_matricula)], [true, true]);
eq('804 matrícula no texto', r.numero_matricula, '25560');
eq('804 judicial (processo/CPC)', r.modalidade, 'judicial');
eq('804 botão "Encerrado" fecha mesmo antes da data', d.encerrado, true);
eq('804 sem foto (sem-imagem.png)', r.link_foto, null);

// 827 — 2º template
const d2 = parseDetalhe(ler('827'), U827, { agora: ANTES });
const r2 = montarRow(U827, d2, T);
eq('827 cidade', [r2.cidade, r2.estado], ['Osório', 'RS']);
eq('827 avaliação e lance das Observações', [r2.valor_avaliacao, r2.valor_minimo], [1300000, 1300000]);
eq('827 data do input oculto; praça única', [r2.data_leilao, r2.data_leilao_2], ['2026-11-11T10:30:00-03:00', null]);
eq('827 aberto', d2.encerrado, false);
eq('827 depois da praça, encerrado', parseDetalhe(ler('827'), U827, { agora: new Date('2026-11-12T12:00:00-03:00') }).encerrado, true);

// cidade: a sequência mais longa que existe no IBGE
eq('balneário → município', cidadeDoTexto('TERRENO SITUADO NO BALNEÁRIO NOVA TRAMANDAÍ/RS').cidade, 'Tramandaí');
eq('cidade fora do IBGE fica nula', cidadeDoTexto('LUGAR NENHUM/RS').cidade, null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ lucian-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
