// WR LEILÕES (wrleiloes.com.br, 30/10) — páginas reais (sem <script>/<style>):
//   agenda: `/agenda-de-leiloes` (TRT11 734 + SMTRAN 810); leilao-734: TRT11 "IMOVEIS e MOVEIS" pág. 1 (20 cards, 4
//   veículos), 30/11/2026 10:00, "Aberto para Lances"; 54339: terreno com casa em Manaus ("desta cidade" + "Registro …
//   de Manaus/AM"); 54348: apartamento em Manaus ("… Protestos de Letras de Manaus."); 54358: Boa Vista-RR; 54362:
//   fazenda em Rio Preto da Eva – AM (280 ha); 54342: móveis (mesa, guarda-roupa) num card "DIVERSOS/".
import fs from 'fs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl, cidadeDoBem } from '../lib/wrleiloes-parse.mjs';
const ler = (n) => fs.readFileSync(new URL(`./fixtures/wrleiloes-${n}.html`, import.meta.url), 'utf8');
const B = 'https://www.wrleiloes.com.br';
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.wrleiloes;
const LEILAO = ler('leilao-734');
const fetchFonte = async (u) => (/\/leilao\/734\//.test(u) ? { html: LEILAO, via: 'direto' } : { html: null, via: 'direto-404' });
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

eq('agenda: só o leilão do TRT11 (SMTRAN é só veículo)', [...extrairUrlsDeEvento(ler('agenda')).keys()], ['734']);
const lotes = extrairUrlsDeLote(LEILAO);
eq('leilão 734 pág. 1: 16 de 20 cards (4 veículos fora)', [lotes.size, lotes.has('54340'), lotes.has('54339')], [16, false, true]);
eq('id do lote', idDaUrl(`${B}/lote/54339/diversos-`), '54339');

const lote = async (id) => { const u = `${B}/lote/${id}/diversos-`; const d = await parseDetalhe(ler(`lote-${id}`), u, { fetchFonte, agora: HOJE }); return { d, r: d && montarRow(u, d, T) }; };

const { d, r } = await lote('54339');
eq('54339 título/cidade', [r.titulo, r.cidade, r.estado], ['Terreno - Rua Vinte e Quatro de Maio - Manaus/AM', 'Manaus', 'AM']);
eq('54339 avaliação 800 mil, lance 40% = 320 mil, data do LEILÃO', [r.valor_avaliacao, r.valor_minimo, r.data_leilao], [800000, 320000, '2026-11-30T10:00:00-03:00']);
eq('54339 judicial, matrícula 5112, 357,05 m², aberto', [r.modalidade, r.numero_matricula, r.area_m2, d.encerrado, d.naoImovel], ['judicial', '5112', 357.05, false, false]);
eq('54339 foto (slide vazio fora) e edital PDF', [d.fotos.length, /\/imgTmp\/ft[0-9a-f]+\.png$/.test(r.link_foto), /\/download\/[0-9a-f]+\.pdf$/.test(r.link_edital)], [1, true, true]);
eq('54339 passa na qualidade', checarQualidade(r, { estrito: false }).descartar, false);

const a = await lote('54348');
eq('54348 apartamento em Manaus (nome sem UF)', [a.r.titulo, a.r.tipo, a.r.cidade], ['Apartamento - Rua Rio Madeira, Nº 1122 - Manaus/AM', 'apartamento', 'Manaus']);
eq('54348 valores e matrícula', [a.r.valor_avaliacao, a.r.valor_minimo, a.r.numero_matricula], [430000, 215000, '14.899']);

const bv = await lote('54358');
eq('54358 Boa Vista-RR', [bv.r.cidade, bv.r.estado, bv.r.valor_minimo, bv.r.numero_matricula], ['Boa Vista', 'RR', 172500, '121.395']);

const fz = await lote('54362');
eq('54362 fazenda em Rio Preto da Eva – AM, rural, avaliada em sua totalidade', [fz.r.cidade, fz.r.tipo, fz.r.valor_avaliacao, fz.r.valor_minimo], ['Rio Preto da Eva', 'rural', 550570.33, 220228.12]);

const mv = await lote('54342');
eq('54342 móveis num card DIVERSOS = não imóvel', mv.d.naoImovel, true);

eq('UF por extenso vira sigla', cidadeDoBem('no município de Parintins, Estado do Amazonas, medindo'), { cidade: 'Parintins', estado: 'AM' });
eq('sem nome de cidade → nula (não inventa Manaus)', cidadeDoBem('Uma área de terras localizada no lado direito da Estrada dos Moraes'), { cidade: null, estado: null });

const enc = await parseDetalhe(ler('lote-54339'), `${B}/lote/54339/x`, { fetchFonte: async () => ({ html: LEILAO.replace('status aberto', 'status encerrado').replace('Aberto para Lances', 'Encerrado'), via: 'direto' }), agora: HOJE });
eq('leilão encerrado → lote encerrado', enc.encerrado, true);
const semLeilao = await parseDetalhe(ler('lote-54339'), `${B}/lote/54339/x`, { fetchFonte: async () => ({ html: null, via: 'direto-503' }), agora: HOJE });
eq('leilão fora do ar → null (sem detalhe), nunca lote sem data', semLeilao, null);
eq('página sem lote → null', await parseDetalhe('<body>nada</body>', `${B}/lote/1/x`, { agora: HOJE }), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ wrleiloes-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
