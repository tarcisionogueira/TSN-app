// LUIZ CAMPOLINA (luizcampolina.com.br, 30/10) — catálogo real da Store API do WooCommerce, categoria `imoveis`:
//   6416 gleba de 10.021 m² em Sete Lagoas (aberta; avaliação 9 mi, lance mínimo 4,5 mi);
//   6422 50% de casa (fração — o checarQualidade descarta); 6457 e 6424 "*SUSPENSO*"; 6426 veículo cancelado na
//   categoria errada.
import fs from 'fs';
import { TENANTS, extrairUrlsDeLote, detalhesDoCatalogo, montarRow, checarQualidade, dataDoLeilao, idDaUrl } from '../lib/campolina-parse.mjs';
const txt = fs.readFileSync(new URL('./fixtures/campolina-catalogo-imoveis.json', import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const urls = extrairUrlsDeLote(txt);
eq('catálogo: 5 produtos, id estável na url', [urls.size, idDaUrl(urls.get('6416'))], [5, '6416']);
const dets = detalhesDoCatalogo(txt);
const det = (id) => dets.get(urls.get(id));
const row = (id) => montarRow(urls.get(id), det(id), TENANTS.campolina);

const g = row('6416');
eq('6416 avaliação e LANCE MÍNIMO (não a avaliação)', [g.valor_avaliacao, g.valor_minimo], [9000000, 4500000]);
eq('6416 cidade da LOCALIZAÇÃO "– SETE LAGOAS – MG"', [g.cidade, g.estado], ['Sete Lagoas', 'MG']);
eq('6416 1º leilão 10/11 15h, aberto', [g.data_leilao, det('6416').encerrado], ['2026-11-10T15:00:00-03:00', false]);
eq('6416 área, matrícula, edital PDF', [g.area_m2, g.numero_matricula, /EDITAL-03-2026-3a-VARA-SETE-LAGOAS\.pdf$/.test(g.link_edital)], [10021.12, '55.090', true]);
eq('6416 url do lote sem ?lote= e fonte_id pelo id do produto', [/\?/.test(g.url_lote), g.fonte_id], [false, 'luizcampolina_6416']);
eq('6416 passa na qualidade', checarQualidade(g, { estrito: false }).descartar, false);

eq('6457 e 6424 suspensos = encerrados', [det('6457').encerrado, det('6424').encerrado], [true, true]);
eq('6426 veículo na categoria imóveis = não-imóvel', det('6426').naoImovel, true);
eq('6422 50% = fração ideal descartada', checarQualidade(row('6422'), { estrito: false }).faltando, ['fracao_ideal']);

eq('data: mês por extenso, ano de 2 dígitos', dataDoLeilao('2º LEILÃO: 24-NOVEMBRO-26 – TERÇA FEIRA 14:30 HORAS', 2), '2026-11-24T14:30:00-03:00');
eq('data: mês numérico', dataDoLeilao('1º LEILÃO: 05/12/2026 às 10:00', 1), '2026-12-05T10:00:00-03:00');
eq('catálogo que não é JSON → vazio', extrairUrlsDeLote('<html>erro</html>').size, 0);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `✓ campolina-parse: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
