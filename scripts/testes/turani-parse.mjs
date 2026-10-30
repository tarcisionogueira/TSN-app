// GUSTAVO TURANI LEILÕES (turanileiloes.com.br, 30/10) — páginas reais (sem <script>/<style>, `_token` zerado):
//   lista-p1: `/imoveis` pág. 1 (8 lotes abertos + 6 auditórios); lista-p35: a virada, 2 abertos e 6 "LEILÃO ENCERRADO";
//   lote-*.json: `GET /lotes/<id>/atualiza-pagina` —
//   5685: conjunto comercial em Porto Alegre, venda extrajudicial, praça única 10/11;
//   1095: fração ideal rural em Bom Princípio, 1ª praça R$ 50.000 e 2ª R$ 25.000 nas informações (17 e 24/11);
//   5674: casa (TRT4, alienação particular) entre as praças — vale a 2ª (03/11), cidade só pelo CRI de Porto Alegre;
//   4568: `aberto: 0` com as datas ainda no futuro (encerrado antes da praça).
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade, idDaUrl, urlJson } from '../lib/turani-parse.mjs';
const lerH = (n) => fs.readFileSync(new URL(`./fixtures/turani-${n}.html`, import.meta.url), 'utf8');
const lerJ = (id) => fs.readFileSync(new URL(`./fixtures/turani-lote-${id}.json`, import.meta.url), 'utf8');
const HOJE = new Date('2026-10-30T12:00:00-03:00');
const T = TENANTS.turani;
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const lote = (id) => { const u = urlJson(id); const d = parseDetalhe(lerJ(id), u, { agora: HOJE }); return { d, r: d && montarRow(u, d, T) }; };

const l1 = extrairUrlsDeLote(lerH('lista-p1'));
eq('lista p1: 8 lotes (auditórios fora), URL do JSON', [l1.size, l1.get('5685')], [8, 'https://www.turanileiloes.com.br/lotes/5685/atualiza-pagina']);
eq('lista p35: só os 2 abertos (encerrados fora)', [...extrairUrlsDeLote(lerH('lista-p35')).keys()].sort(), ['3276', '5684']);
eq('id da URL pública e do JSON', [idDaUrl('https://www.turanileiloes.com.br/imoveis/5685-conjunto-no-801'), idDaUrl(urlJson(5685))], ['5685', '5685']);

const { d, r } = lote(5685);
eq('5685 título + tipo pelas informações', [r.titulo, r.tipo], ['Conjunto Nº 801 do Edifício Buchaim, no Centro Histórico de Porto Alegre/RS', 'comercial']);
eq('5685 cidade/UF', [r.cidade, r.estado], ['Porto Alegre', 'RS']);
eq('5685 avaliação, lance mínimo (= LANCE MÍNIMO das informações), praça única', [r.valor_avaliacao, r.valor_minimo, r.valor_minimo_2, r.data_leilao, r.data_leilao_2], [282936.5, 198055.55, null, '2026-11-10T14:30:00-03:00', null]);
eq('5685 extrajudicial, aberto', [r.modalidade, d.encerrado], ['extrajudicial', false]);
eq('5685 url_lote = página pública, edital PDF, matrícula 1.743, 146,98 m²',
  [r.url_lote, /\/uploads\/lotes\/5685\/.+\.pdf$/.test(r.link_edital), r.numero_matricula, r.area_m2],
  ['https://www.turanileiloes.com.br/imoveis/5685-conjunto-no-801-do-edificio-buchaim-no-centro-historico-de-porto-alegrers', true, '1.743', 146.98]);
eq('5685 fotos (capa + galeria)', [r.fotos.length, /\/uploads\/lotes\/5685\//.test(r.link_foto)], [5, true]);
eq('5685 passa na qualidade', checarQualidade(r, { estrito: false }).descartar, false);

const b = lote(1095);
eq('1095 duas praças com os valores das informações', [b.r.valor_minimo, b.r.valor_minimo_2, b.r.data_leilao, b.r.data_leilao_2], [50000, 25000, '2026-11-17T14:30:00-03:00', '2026-11-24T14:30:00-03:00']);
eq('1095 Bom Princípio/RS, judicial, matrícula 29.447', [b.r.cidade, b.r.modalidade, b.r.numero_matricula], ['Bom Princípio', 'judicial', '29.447']);
eq('1095 fração ideal → fora do acervo (regra do dono)', checarQualidade(b.r, { estrito: false }).descartar, true);

const c = lote(5674);
eq('5674 entre praças: vale a 2ª (03/11), lance = inicial + incremento (50% da avaliação)', [c.r.data_leilao, c.r.data_leilao_2, c.r.valor_minimo, c.r.valor_avaliacao], ['2026-11-03T14:30:00-03:00', null, 220000, 440000]);
eq('5674 cidade pelo CRI, título com algarismo romano', [c.r.cidade, c.r.titulo], ['Porto Alegre', 'Casa Nº 06 do Condomínio Residencial Vida Nova Garden II - Porto Alegre/RS']);
eq('5674 judicial (TRT4), casa, matrícula 185.294', [c.r.modalidade, c.r.tipo, c.r.numero_matricula], ['judicial', 'casa', '185.294']);

eq('4568 aberto=0 com praça futura → encerrado', lote(4568).d.encerrado, true);
eq('5685 visto depois da praça → encerrado', parseDetalhe(lerJ(5685), urlJson(5685), { agora: new Date('2026-11-11T12:00:00-03:00') }).encerrado, true);
eq('categoria que não é imóvel → naoImovel', parseDetalhe(lerJ(5685).replace('"slug":"imoveis"', '"slug":"veiculos"'), urlJson(5685), { agora: HOJE }).naoImovel, true);
eq('corpo que não é JSON → null', parseDetalhe('<html>erro</html>', urlJson(1)), null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ turani-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
