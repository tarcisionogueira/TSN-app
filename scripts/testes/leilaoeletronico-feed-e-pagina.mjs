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

// (7) Cidade-padrão do feed ("Acrelândia/Acre", lote recém-cadastrado) não vence o título nem a descrição.
const URL_2824 = 'https://www.leilaoeletronico.com.br/lote/leilao-de-apartamento-e-vaga-em-brasilia-df/2824/';
const URL_2823 = 'https://www.leilaoeletronico.com.br/lote/leilao-de-casa-no-bairro-jardim-mar-sao-bernardo-do-campo/2823/';
const acre = (u) => listing(`<name>EXTRAJUDICIAL</name> <address format="simples"> <component name="city">Acrelândia</component> <component name="region">Acre</component> </address>
 <price>160000,00 BRL</price> <url>${u}</url> <available_dates_price_config> <end_date>2099-01-01T14:00:00</end_date> <rate>160000,00 BRL</rate> </available_dates_price_config>`);
extrairUrlsDeLote(`<listings>${acre(URL_2824)}${acre(URL_2823)}</listings>`, T.base);
const pg = (titulo, desc) => `<ul><li><a href="/">Home</a></li><li>${titulo}</li></ul><section id="dg-lote-descricao"><h2>Descrição</h2><p>${desc}</p></section>`;
const d4 = parseDetalhe(pg('Leilão de Apartamento e Vaga em Brasília/DF EXTRAJUDICIAL', 'Apartamento com vaga.'), URL_2824, { agora: AGORA });
assert.deepEqual([d4.cidade, d4.estado], ['Brasília', 'DF']);
const d5 = parseDetalhe(pg('Leilão de Casa no Bairro Jardim Mar EXTRAJUDICIAL', 'Casa situada na cidade de São Bernardo do Campo/SP, matrícula 123.'), URL_2823, { agora: AGORA });
assert.deepEqual([d5.cidade, d5.estado], ['São Bernardo do Campo', 'SP']);

// (7b) GF Leilões (24/10, pendência 356 — textos REAIS): o título traz o BAIRRO ("Vila Prudente/ SP", "… | Vila Prudente | SP")
//      e o feed manda "Acrelândia/Acre" em todos os lotes. Cidade só com prova do IBGE; feed com UF diferente da página não vence.
const TG = TENANTS.gf;
const URL_G237 = 'https://www.gfleiloes.com.br/lote/imovel-comercial-area-de-400m_-vila-prudente-sp/237/';
const URL_G300 = 'https://www.gfleiloes.com.br/lote/imovel-area-de-24500m_-vila-carbone-sp/300/';
const URL_G303 = 'https://www.gfleiloes.com.br/lote/imovel-area-de-35200m_-regente-feijo-sp/303/';
const gfFeed = (u, cidade = 'Acrelândia', regiao = 'Acre') => listing(`<name>JUDICIAL</name> <address format="simples"> <component name="city">${cidade}</component> <component name="region">${regiao}</component> </address>
 <price>1746000,00 BRL</price> <url>${u}</url> <available_dates_price_config> <end_date>2099-01-01T14:00:00</end_date> <rate>873000,00 BRL</rate> </available_dates_price_config>`);
extrairUrlsDeLote(`<listings>${gfFeed(URL_G237)}${gfFeed(URL_G300, 'Curitiba', 'Paraná')}${gfFeed(URL_G303)}</listings>`, TG.base);
const pgGF = (bc, h1, desc) => `<ul> <li><a href="/">Home</a></li> <li><a href="#">Comerciais</a></li> <li>${bc}</li> </ul>
 <h1 class="dg-lote-titulo"> ${h1} | <span class="dg-lote-titulo-codigo"><strong>x</strong></span></h1>
 <section id="dg-lote-descricao"><h2>Descrição</h2><p>${desc}</p></section>`;
const g237 = parseDetalhe(pgGF('Im&#xF3;vel Comercial | &#xC1;rea de 400m&#xB2; | Vila Prudente/ SP Im&#xF3;vel Comercial | &#xC1;rea de 400m&#xB2; | Rua Coelho Neto, n&#xBA; 199 | Vila Prudente | SP',
  'Im&#xF3;vel Comercial | &#xC1;rea de 400m&#xB2; | Vila Prudente/ SP', 'Um prédio sob o nº 199 da Rua Coelho Neto, 26º Subdistrito - Vila Prudente. Comarca: São Paulo/SP'), URL_G237, { agora: AGORA });
assert.deepEqual([g237.cidade, g237.estado], ['São Paulo', 'SP'], 'bairro do título não é cidade; Acrelândia do feed não vence');
const g300 = parseDetalhe(pgGF('Im&#xF3;vel | &#xC1;rea de 245,00m&#xB2; | Rua Doutor Salvador Caborni, n&#xBA; 25/31 | Vila Carbone/SP',
  'Im&#xF3;vel | &#xC1;rea de 245,00m&#xB2; | Vila Carbone/SP', 'Imóvel com 245,00m².'), URL_G300, { agora: AGORA });
assert.deepEqual([g300.cidade, g300.estado], [null, 'SP'], 'sem cidade provada: nulo com a UF da página — o Curitiba/PR do feed não entra');
const g303 = parseDetalhe(pgGF('Im&#xF3;vel | &#xC1;rea de 352,00m&#xB2; | Avenida Regente Feij&#xF3;, n&#xBA; 667 | Regente Feij&#xF3;/SP',
  'Im&#xF3;vel | &#xC1;rea de 352,00m&#xB2; | Regente Feij&#xF3;/SP', 'Imóvel com 352,00m².'), URL_G303, { agora: AGORA });
assert.deepEqual([g303.cidade, g303.estado], ['Regente Feijó', 'SP'], 'município de verdade no título continua valendo');

// (8) MULTI-TENANT (24/10). O id é sequencial por SITE: o 375 da Milhão não pode receber o feed do 375 de outro
//     tenant lido antes no mesmo processo, e lote que só existe no feed de OUTRO site não está "no feed" deste.
const TM = TENANTS.milhao, TT = TENANTS.taba;
const URL_M375 = 'https://www.milhaoleiloes.com.br/lote/leilao-judicial-imovel-comercial-e-residencial/375/';
const URL_X375 = 'https://www.tabaleiloes.com.br/lote/imoveis-residenciais-banco-itau-e484-r/375/';
const URL_T35156 = 'https://www.tabaleiloes.com.br/lote/terrenos-e-apartamento-j0132/35156/';
// Taba primeiro (o runner roda os tenants em sequência): o 375 dela tem cidade/praça diferentes.
const urlsTaba = extrairUrlsDeLote(`<listings>${listing(`<name>Lote 18 - Ananindeua - PA - Águas Brancas - Terreno</name> <address format="simples"> <component name="city">Ananindeua</component> <component name="region">Pará</component> </address>
 <url>${URL_X375}</url> <available_dates_price_config> <end_date>2026-11-20T10:00:00</end_date> <rate>50000,00 BRL</rate> </available_dates_price_config>`)}${listing(`<name>Ubatuba - SP</name> <url>${URL_T35156}</url>
 <available_dates_price_config> <end_date>2026-11-12T14:00:00</end_date> <rate>90905823 BRL</rate> </available_dates_price_config>`)}</listings>`, TT.base);
// `\bmoveis-`: o slug "imoveis-residenciais-…" é imóvel (antes caía no filtro de mobília — 154 de 178 lotes da Taba).
assert.deepEqual([...urlsTaba.keys()].sort(), ['35156', '375']);
// Milhão depois — feed REAL do lote 375 (24/10), praças em centavos.
extrairUrlsDeLote(`<listings>${listing(`<home_listing_id>375</home_listing_id> <name>Imóvel Comercial e Residencial em Lagamar/MG</name> <address format="simples"> <component name="city">Lagamar</component> <component name="region">Minas Gerais</component> </address>
 <latitude>-18.183059</latitude> <longitude> -46.803848</longitude> <price>180000,00 BRL</price> <url>${URL_M375}</url>
 <available_dates_price_config> <start_date>2026-11-30T14:00:00</start_date> <end_date>2026-12-04T13:00:00</end_date> <rate>18000000 BRL</rate> </available_dates_price_config>
 <available_dates_price_config> <start_date>2026-12-04T14:00:00</start_date> <end_date>2026-12-14T14:00:00</end_date> <rate>12600000 BRL</rate> </available_dates_price_config>`)}</listings>`, TM.base);
// Página do 375 da Milhão no 2º tema (h1 `dg-lote-titulo` + `dg-lote-nome`; breadcrumb = leilão + lote colados).
const pgMilhao = `<nav class="dg-breadcrumb"> <ul> <li><a href="https://www.milhaoleiloes.com.br/">Home</a></li> <li><a href="#">Comerciais</a></li> <li>Leil&#xE3;o Judicial - Im&#xF3;vel Comercial e Residencial Im&#xF3;vel Comercial e Residencial em Lagamar/MG</li> </ul> </nav>
 <h1 class="dg-lote-titulo"> <span class="dg-lote-nome">Im&#xF3;vel Comercial e Residencial em Lagamar/MG</span> | <span class="dg-lote-nome-titulo-codigo">Cód do leilão: <strong>lj00192/001</strong></span> <span class="dg-lote-titulo-categoria">Comerciais</span> </h1>
 <span>Avaliação:</span> <strong class="ValorAvaliacao" DataLabel="R$ ">R$180.000,00</strong><br>`;
const m375 = parseDetalhe(pgMilhao, URL_M375, { agora: AGORA });
assert.equal(m375.titulo, 'Imóvel Comercial e Residencial em Lagamar/MG', 'título = dg-lote-nome, não o breadcrumb duplicado');
assert.deepEqual([m375.cidade, m375.estado], ['Lagamar', 'MG']);
assert.deepEqual([m375.valor_avaliacao, m375.valor_minimo, m375.valor_minimo_2, m375.data_leilao], [180000, 180000, 126000, '2026-12-04']);
assert.equal(m375.modalidade, 'judicial', '"Leilão Judicial" no nome do leilão (o h1 deste tema não traz modalidade)');
assert.equal(m375.latitude, -18.183059);
assert.equal(montarRow(URL_M375, m375, TM).fonte_id, 'milhaoleiloes_375');
// O 375 da TABA continua com o feed da Taba (antes: o último feed lido sobrescrevia pelo id).
const t375 = parseDetalhe('<html></html>', URL_X375, { agora: AGORA });
assert.deepEqual([t375.cidade, t375.data_leilao, t375.encerrado], ['Ananindeua', '2026-11-20', false]);
// Lote fora do feed do PRÓPRIO site é encerrado mesmo que o id exista no feed de outro tenant.
assert.equal(parseDetalhe('<html></html>', 'https://www.milhaoleiloes.com.br/lote/sumiu/35156/', { agora: AGORA }).encerrado, true);
// Nome do lote que não diz o bem (Taba "Ubatuba - SP"): título vira "<leilão> - <lote>".
const pgTaba = `<ul> <li><a href="/">Home</a></li> <li><a href="#">Residenciais</a></li> <li>Terrenos e Apartamento - J013(2) Ubatuba - SP</li> </ul>
 <h1 class="dg-lote-titulo"> <span class="dg-lote-nome">Ubatuba - SP</span> | <span>Cód do leilão</span></h1>`;
assert.equal(parseDetalhe(pgTaba, URL_T35156, { agora: AGORA }).titulo, 'Terrenos e Apartamento - J013(2) - Ubatuba - SP');
// Vara antes da cidade (Select 785): "4ª VARA CÍVEL DE DOURADOS/MS" → Dourados.
const pgSelect = `<ul> <li><a href="/">Home</a></li> <li>4ª VARA CÍVEL DE DOURADOS/MS Terreno de 551,78m² em Dourados</li> </ul>
 <h1 class="dg-lote-titulo"> <span class="dg-lote-nome">Terreno de 551,78m² em Dourados</span> | x</h1>`;
const s785 = parseDetalhe(pgSelect, 'https://www.selectleiloes.com.br/lote/4-vara-civel-de-dourados-ms/785/', { agora: AGORA });
assert.deepEqual([s785.cidade, s785.estado], ['Dourados', 'MS']);

// (8b) Categoria "Diversos"/"Veículos" no breadcrumb = não é imóvel (Destak 9366, estrutura eólica); "Cidade - UF" no nome.
const pgDiv = `<ul> <li><a href="/">Home</a></li> <li><a href="#">Diversos</a></li> <li>Estrutura para Gera&#xE7;&#xE3;o de Energia E&#xF3;lica Estrutura</li> </ul>
 <h1 class="dg-lote-titulo"> <span class="dg-lote-nome">Estrutura para Gera&#xE7;&#xE3;o de Energia E&#xF3;lica</span> | x</h1>`;
assert.equal(parseDetalhe(pgDiv, 'https://www.destakleiloes.com.br/lote/estrutura-para-geracao-de-energia-eolica/9366/', { agora: AGORA }).naoImovel, true);
assert.equal(m375.naoImovel, false, 'Comerciais é imóvel');
assert.equal('naoImovel' in montarRow(URL_M375, m375, TM), false, 'a marca não vira coluna do upsert');
const pgTabaCidade = `<ul> <li><a href="/">Home</a></li> <li><a href="#">Rurais</a></li> <li>Im&#xF3;vel Rural com 54 ha - E472 Domingos Martins - ES - Ponto Alto</li> </ul>
 <h1 class="dg-lote-titulo"> <span class="dg-lote-nome">Domingos Martins - ES - Ponto Alto</span> | x</h1>
 <section id="dg-lote-descricao"><p>Endereço: distrito de Paraju, município de Domingos Martins/ES.</p></section>`;
assert.deepEqual((({ cidade, estado }) => [cidade, estado])(parseDetalhe(pgTabaCidade, 'https://www.tabaleiloes.com.br/lote/imovel-rural-com-54-ha-e472/35025/', { agora: AGORA })), ['Domingos Martins', 'ES']);

// (9) Lote que redireciona para o Comprei (UP Leilão 89): a página do gov não é lida como lote (já entra pela COMPREI).
assert.equal(parseDetalhe('<!DOCTYPE html><html><head><meta name="description" content="O Comprei é uma plataforma de negócios do Governo Federal"></head><body><div id="root"></div></body></html>',
  'https://www.upleilao.com.br/lote/grande-oportunidade-pgfn-industrial-em-barueri/89/', { agora: AGORA }), null);

console.log('✓ leilaoeletronico: feed + página → linha (todos os casos)');
