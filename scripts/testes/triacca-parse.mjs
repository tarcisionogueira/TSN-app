// TRIACCA (Lara Forster e Alexsandro Leilões, RS — 30/10) — páginas reais (sem <script>/<style>), charset MISTO
// (declarado iso-8859-1, corpo em UTF-8, bytes Latin-1 soltos no <head>):
//   home-lara: 14 bens (imóvel, veículo e máquina juntos); home-alexsandro: só um lote de TESTE;
//   terreno: aberto, já com lance (R$ 27.500), praças 17/12; 0399casa: "Bem não disponível para leilão" (suspenso).
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade } from '../lib/triacca-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/triacca-${n}.html`, import.meta.url), 'utf8');
const T = TENANTS.laraforster;
const U = (s) => `${T.base}/leilao-virtual/${s}`;
const HOJE = new Date('2026-10-30T12:00:00-03:00');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const lara = extrairUrlsDeLote(ler('home-lara'), T.base);
eq('home Lara: 5 bens (veículos e máquinas fora pelo slug), url absoluta', [lara.size, lara.get('terreno-getlio-vargasrs')], [5, U('terreno-getlio-vargasrs')]);
eq('home Alexsandro: lote de teste fora', extrairUrlsDeLote(ler('home-alexsandro'), TENANTS.alexsandro.base).size, 0);

const d = parseDetalhe(ler('lote-terreno'), U('terreno-getlio-vargasrs'), { tenant: T, agora: HOJE });
const r = montarRow(U('terreno-getlio-vargasrs'), d, T);
eq('terreno: título do <title> (Leil�es com byte solto) e cidade "Getúlio Vargas-RS"', [r.titulo, r.cidade, r.estado], ['Terreno Getúlio Vargas/RS', 'Getúlio Vargas', 'RS']);
eq('terreno: último lance vira o piso, sem avaliação na página', [r.valor_minimo, r.valor_avaliacao], [27500, 0]);
eq('terreno: praças 17/12, aberto, judicial', [r.data_leilao, r.data_leilao_2, d.encerrado, r.modalidade], ['2026-12-17T14:30:00-03:00', '2026-12-17T18:30:00-03:00', false, 'judicial']);
eq('terreno: 300 m², matrícula 11.051 e PDF da matrícula', [r.area_m2, r.numero_matricula, /arquivos\/matriculas\/.+\.pdf$/.test(r.link_matricula)], [300, '11.051', true]);
eq('terreno: foto original absoluta', /^https:\/\/leiloeslaraforster\.com\.br\/fotos\/produtos\/originais\//.test(r.link_foto), true);
eq('terreno: passa na qualidade', checarQualidade(r, { estrito: false }).descartar, false);

const d2 = parseDetalhe(ler('lote-0399casa'), U('leilo-0399casa'), { tenant: T, agora: HOJE });
eq('0399: "Bem não disponível" = encerrado, avaliação lida', [d2.encerrado, d2.valor_avaliacao], [true, 417500]);
eq('0399: edital em PDF', /fotos\/editais\/.+\.pdf$/.test(d2.link_edital), true);

eq('sem praças → null', parseDetalhe('<title>X / Y</title><body>nada</body>', U('x'), { tenant: T }), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ triacca-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
