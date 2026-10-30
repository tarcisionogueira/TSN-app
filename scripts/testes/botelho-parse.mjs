// PAULO BOTELHO (paulobotelholeiloeiro.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   lista-imoveis: `/lotes/imoveis` pág. 1 (12 lotes); 16008: prédio comercial em Campos dos Goytacazes (TRT1);
//   15930: sala 201 da Av. Presidente Vargas, 590 — leilão de nome "bens-moveis…", fração ideal do TERRENO (não fatia);
//   15970: terreno em Macaé, leilão extrajudicial (alienação fiduciária), sem foto (placeholder).
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl } from '../lib/botelho-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/botelho-${n}.html`, import.meta.url), 'utf8');
const B = 'https://www.paulobotelholeiloeiro.com.br/leiloes';
const U16008 = `${B}/bens-imoveis-3011-a-0412-0412-a-0912-rj-2026-11h-489075/16008`;
const U15930 = `${B}/bens-moveis-0911-a-1611-1611-a-1711-rj-2026-11h-817911/15930`;
const U15970 = `${B}/extrajudicial-cabiunas-macae-0611-e-2711-2026-806341/15970`;
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.botelho;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lista = extrairUrlsDeLote(ler('lista-imoveis'));
eq('lista: 12 lotes, id numérico', [lista.size, idDaUrl(U16008)], [12, '16008']);

const d = parseDetalhe(ler('lote-16008'), U16008, { agora: HOJE });
const r = montarRow(U16008, d, T);
eq('16008 título = tipo da descrição + endereço + cidade', r.titulo, 'Prédio - Rua Santo Antonio, 269, Tapera - Campos dos Goytacazes/RJ');
eq('16008 cidade/UF do "Endereço:"', [r.cidade, r.estado], ['Campos dos Goytacazes', 'RJ']);
eq('16008 avaliado = lance (1ª praça), encerra 04/12 11h', [r.valor_avaliacao, r.valor_minimo, r.data_leilao], [490000, 490000, '2026-12-04T11:00:00-03:00']);
eq('16008 aguardando abertura = aberto, judicial', [d.situacao, d.encerrado, r.modalidade], ['Aguardando Abertura', false, 'judicial']);
eq('16008 matrícula "sob o nº 305-A"', r.numero_matricula, '305-A');
eq('16008 foto e edital PDF', [/16008_FOTO\.JPG$/.test(r.link_foto), /\/frontend\/documents\/.+\.pdf$/.test(r.link_edital)], [true, true]);

const d2 = parseDetalhe(ler('lote-15930'), U15930, { agora: HOJE });
const r2 = montarRow(U15930, d2, T);
eq('15930 sala comercial no Rio', [r2.titulo, r2.cidade], ['Sala comercial - Avenida Presidente Vargas, 590 - Rio de Janeiro/RJ', 'Rio de Janeiro']);
eq('15930 fração ideal do TERRENO não descarta a sala', checarQualidade(r2, { estrito: false }).descartar, false);
eq('15930 matrícula "sob o n.º 15.201"', r2.numero_matricula, '15.201');

const d3 = parseDetalhe(ler('lote-15970'), U15970, { agora: HOJE });
const r3 = montarRow(U15970, d3, T);
eq('15970 extrajudicial pelo nome do leilão', r3.modalidade, 'extrajudicial');
eq('15970 terreno em Macaé, 261,46 m², sem foto (placeholder fora)', [r3.tipo, r3.cidade, r3.area_m2, r3.link_foto], ['terreno', 'Macaé', 261.46, null]);
eq('15970 1ª praça 06/11 12h', r3.data_leilao, '2026-11-06T12:00:00-03:00');

eq('encerrado pela situação', parseDetalhe(ler('lote-16008').replace('Aguardando Abertura', 'Encerrado'), U16008, { agora: HOJE }).encerrado, true);
eq('página sem cabeçalho de lote → null', parseDetalhe('<body>Diversos nada</body>', U16008), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ botelho-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
