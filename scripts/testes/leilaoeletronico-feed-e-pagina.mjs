// LEILÃO ELETRÔNICO (23/10, pendência 307): feed /sitemap.xml + página do lote → linha do acervo. Formas REAIS
// medidas: lote 2653 (casa R$ 18 mi, 1 praça a R$ 15 mi, rate em REAIS com vírgula) e 2419 (2 praças, rate em
// CENTAVOS sem separador); o JSON-LD da página descreve OUTRO lote e não pode vazar para a linha.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extrairUrlsDeLote, parseDetalhe, montarRow, idDaUrl, valorDoFeed, TENANTS } from '../lib/leilaoeletronico-parse.mjs';

const T = TENANTS.leilaoeletronico;
const pagina2653 = readFileSync(new URL('./fixtures/leilaoeletronico-lote-2653.html', import.meta.url), 'utf8');
const URL_2653 = 'https://www.leilaoeletronico.com.br/lote/leilao-de-casa-de-alto-padrao-em-santana-de-parnaiba-sp/2653/';
const URL_2419 = 'https://www.leilaoeletronico.com.br/lote/leilao-de-predio-de-2-andares-em-colorado-do-oeste-ro/2419/';
const AGORA = new Date('2026-10-23T15:00:00-03:00');

const listing = (corpo) => `<listing>${corpo}</listing>`;
const feed = `<?xml version="1.0"?><listings>
${listing(`<home_listing_id>2653</home_listing_id> <name>EXTRAJUDICIAL</name> <address format="simples"> <component name="city">Santana de Parnaíba</component> <component name="region">São Paulo</component> </address>
 <latitude>-23.473705034577538</latitude> <longitude> -46.85528758835967</longitude> <neighborhood>Tamboré</neighborhood>
 <image> <url>https://www.leilaoeletronico.com.br/imagens/1200x1200/b87aab10.jpg</url> </image> <image> <url>https://www.leilaoeletronico.com.br/imagens/1200x1200/491f7c35.jpg</url> </image>
 <price>18000000,00 BRL</price> <property_type>house</property_type> <url>${URL_2653}</url>
 <available_dates_price_config> <start_date>2026-09-17T14:00:00</start_date> <end_date>2026-10-27T14:54:00</end_date> <rate>15000000,00 BRL</rate> </available_dates_price_config>`)}
${listing(`<home_listing_id>2419</home_listing_id> <name>JUDICIAL</name> <address format="simples"> <component name="city">Colorado do Oeste</component> <component name="region">Rondônia</component> </address>
 <latitude /> <longitude /> <neighborhood>Odilon Noia</neighborhood> <price>1693902,00 BRL</price> <url>${URL_2419}</url>
 <available_dates_price_config> <end_date>2026-10-08T14:30:00</end_date> <rate>169390200 BRL</rate> </available_dates_price_config>
 <available_dates_price_config> <end_date>2026-10-29T14:30:00</end_date> <rate>84695100 BRL</rate> </available_dates_price_config>`)}
${listing(`<name>EXTRAJUDICIAL</name> <url>https://www.leilaoeletronico.com.br/lote/leilao-de-apartamento-antigo/1500/</url>
 <available_dates_price_config> <end_date>2026-09-01T14:00:00</end_date> <rate>300000,00 BRL</rate> </available_dates_price_config>`)}
${listing(`<name>EXTRAJUDICIAL</name> <url>https://www.leilaoeletronico.com.br/lote/leilao-de-veiculo-honda-fit-2012/2900/</url>
 <available_dates_price_config> <end_date>2099-01-01T14:00:00</end_date> <rate>30000,00 BRL</rate> </available_dates_price_config>`)}
</listings>`;

// (1) Formato do <rate>: com vírgula = reais; sem vírgula = centavos.
assert.equal(valorDoFeed('15000000,00 BRL'), 15000000);
assert.equal(valorDoFeed('169390200 BRL'), 1693902);
assert.equal(valorDoFeed(''), 0);

// (2) Enumeração: só lote aberto e imóvel (o encerrado 1500 e o veículo 2900 ficam fora).
const urls = extrairUrlsDeLote(feed, T.base);
assert.deepEqual([...urls.keys()].sort(), ['2419', '2653']);
assert.equal(idDaUrl(URL_2653), '2653');

// (3) Lote 2653: página + feed. Avaliação da PÁGINA (R$ 18 mi), não a do JSON-LD (R$ 2,7 mi, outro lote).
const d = parseDetalhe(pagina2653, URL_2653, { agora: AGORA });
assert.equal(d.titulo, 'Casa de Alto Padrão, em Santana de Parnaíba/SP');
assert.equal(d.valor_avaliacao, 18000000);
assert.equal(d.valor_minimo, 15000000);
assert.equal(d.valor_minimo_2, null);
assert.equal(d.data_leilao, '2026-10-27');
assert.equal(d.modalidade, 'extrajudicial');
assert.deepEqual([d.cidade, d.estado, d.bairro], ['Santana de Parnaíba', 'SP', 'Tamboré']);
assert.equal(d.area_m2, 1058.3);
assert.equal(d.numero_matricula, '4525');
assert.equal(d.numero_processo, '1004735-53.2025.8.26.0529');
assert.ok(/Alameda Jap[ãa]o, 205/.test(d.descricao) && !/&\w+;/.test(d.descricao), 'descrição decodificada');
assert.equal(d.endereco, 'Alameda Japão, 205 - Tamboré - Santana de Parnaíba - SP');
assert.deepEqual(d.anexos.map((a) => a.tipo), ['edital', 'matricula']);
assert.ok(d.anexos.every((a) => a.url.includes('/download/')), 'só /download/ (o /preview/ é o mesmo PDF)');
assert.equal(d.link_foto, 'https://www.leilaoeletronico.com.br/imagens/1200x1200/b87aab10.jpg');
assert.equal(d.encerrado, false);

const r = montarRow(URL_2653, d, T);
assert.equal(r.fonte, 'LEILAOELETRONICO');
assert.equal(r.fonte_id, 'leilaoeletronico_2653');
assert.equal(r.tipo, 'casa');
assert.equal(r.desconto_percentual, 17);
assert.equal(r.fotos.length, 2);
assert.equal(r.latitude, -23.473705034577538);
assert.equal(r.geocod_nivel, 'endereco');
assert.equal(r.leiloeiro, 'Leilão Eletrônico');

// (4) Lote 2419 (página mínima: só o feed fala): 1ª praça vencida → vale a 2ª; rate em centavos; sem coordenada.
const d2 = parseDetalhe('<html><body></body></html>', URL_2419, { agora: AGORA });
assert.equal(d2.valor_avaliacao, 1693902);
assert.equal(d2.valor_minimo, 846951);
assert.equal(d2.data_leilao, '2026-10-29');
assert.equal(d2.data_leilao_2, null);
assert.equal(d2.modalidade, 'judicial');
assert.deepEqual([d2.cidade, d2.estado], ['Colorado do Oeste', 'RO']);
assert.equal(d2.latitude, null);
assert.equal(montarRow(URL_2419, d2, T).geocod_nivel, undefined, 'sem coordenada o geocodificador decide');

// (5) Antes da 1ª praça do 2419: 1ª vigente, 2ª separada com a própria data e lance.
const d3 = parseDetalhe('<html></html>', URL_2419, { agora: new Date('2026-10-01T12:00:00-03:00') });
assert.equal(d3.valor_minimo, 1693902);
assert.equal(d3.valor_minimo_2, 846951);
assert.equal(d3.data_leilao, '2026-10-08');
assert.equal(d3.data_leilao_2, new Date('2026-10-29T14:30:00-03:00').toISOString());

// (6) Lote encerrado no feed ou fora dele = encerrado (o acervo não reabre o histórico).
assert.equal(parseDetalhe('<html></html>', 'https://www.leilaoeletronico.com.br/lote/leilao-de-apartamento-antigo/1500/', { agora: AGORA }).encerrado, true);
assert.equal(parseDetalhe('<html></html>', 'https://www.leilaoeletronico.com.br/lote/sumiu-do-feed/9999/', { agora: AGORA }).encerrado, true);

console.log('✓ leilaoeletronico: feed + página → linha (todos os casos)');
