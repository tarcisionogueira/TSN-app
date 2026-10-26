// LeilãoPro (24/10, tenants das Juntas Comerciais): textos REAIS das páginas lidas no seco.
//  - preço: o "LANCE INICIAL" sem número é o lance VIGENTE do card; não pode vencer o rótulo numerado do 1º leilão
//    (Renovar 10335), e sem 2º leilão, abaixo da avaliação, ele é o mínimo (Raupp 6457). "1ª/2ª DATA" = 1º/2º leilão (NS).
//  - cidade: o og:title termina com o nome do site ("… - JAC Leilões | Site do leiloeiro oficial de Cascavel/PR") e
//    o Cascavel/PR do LEILOEIRO virava a cidade do lote; "Cidade - UF" no título só vale com prova do IBGE.
import assert from 'node:assert/strict';
import { parseDetalhe, cidadeUF, cidadeDoCorpo, cidadeDoSlugLeilao, extrairUrlsDeLote, idDaUrl } from '../lib/leilaopro-parse.mjs';

const pagina = (ogTitle, corpo) => `<html><head><title>${ogTitle}</title>
<meta property="og:title" content="${ogTitle}"><meta property="og:description" content="${ogTitle}"></head>
<body><div>${corpo}</div></body></html>`;

// Renovar 10335 — 2º leilão em curso: card 630 mil, 1º 700 mil, 2º 630 mil.
let d = parseDetalhe(pagina('IMÓVEL URBANO C/ 610,5M² EM JOINVILLE - SC - Renovar Leilões - Corrêa e Alegranzzi LTDA',
  'LANCE INICIAL R$ 630.000,00 COMISSÃO R$ 31.500,00 5% LANCE INICIAL 1º LEILÃO R$ 700.000,00 LANCE INICIAL 2º LEILÃO R$ 630.000,00 INCREMENTO MÍNIMO R$ 1.000,00'),
  'https://renovarleiloes.com.br/leilao/x/lote_id/10335');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo], [700000, 630000], 'Renovar: 1º leilão é a avaliação, 2º é o mínimo');
assert.deepEqual([d.cidade, d.estado], ['Joinville', 'SC'], 'Renovar: "EM JOINVILLE - SC" no título');
assert.equal(d.titulo, 'IMÓVEL URBANO C/ 610,5M² EM JOINVILLE - SC', 'sufixo do site sai do título');

// Raupp 6457 — sem 2º leilão: lance 161 mil sobre avaliação de 230 mil.
d = parseDetalhe(pagina('(PORTO ALEGRE/RS) O APTO N°408 DO EDIFÍCIO ILHA POI, C/ 68,97M² - Raupp Leilões - Naio de Freitas Raupp - Leiloeiro Oficial',
  'LANCE INICIAL R$ 161.000,00 SEJA O PRIMEIRO A ENVIAR UM LANCE COMISSÃO R$ 16.100,00 10% AVALIAÇÃO R$ 230.000,00 LANCE MÍNIMO R$ 161.000,00'),
  'https://rauppleiloes.com.br/leilao/x/lote_id/6457');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo], [230000, 161000], 'Raupp: lance vigente abaixo da avaliação é o mínimo');

// NS Leilões 3099 — "1ª DATA" / "2ª DATA".
d = parseDetalhe(pagina('TERRENO EM ESTEIO/RS - NS Leilões - Presenciais e Online',
  'LANCE INICIAL R$ 180.000,00 COMISSÃO 5% SOBRE O VALOR DO LANCE LANCE INICIAL 1ª DATA R$ 180.000,00 LANCE INICIAL 2ª DATA R$ 90.000,00'),
  'https://nsleiloes.leilao.br/leilao/x/lote_id/3099');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo], [180000, 90000], 'NS: 2ª data é o 2º leilão');

// Leffa (golden record de 20/08): layout sem número no 1º leilão — nada muda.
d = parseDetalhe(pagina('APARTAMENTO NA CIDADE DE TORRES/RS', 'LANCE INICIAL R$ 1.180.000,00 LANCE INICIAL 2º LEILÃO R$ 590.000,00 INCREMENTO MÍNIMO R$ 1.000,00'),
  'https://www.leffaleiloes.com.br/leilao/x/lote_id/7208');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo, d.cidade, d.estado], [1180000, 590000, 'Torres', 'RS']);

// JAC 281 — o "Cascavel/PR" do sufixo do site não pode virar a cidade do lote em Medianeira.
d = parseDetalhe(pagina('SALA COMERCIAL EM MEDIANEIRA - PR RUA SANTA CATARINA, 2190 • 124,20M² - JAC Leilões | Site do leiloeiro oficial de Cascavel/PR - Jefferson Adriano Costa',
  'LANCE INICIAL R$ 510.000,00 LANCE INICIAL 1ª DATA R$ 510.000,00'), 'https://jacleiloes.com.br/leilao/x/lote_id/281');
assert.deepEqual([d.cidade, d.estado], ['Medianeira', 'PR']);

// cidadeUF: barra dobrada, sufixo que é município, hífen sem prova do IBGE não inventa cidade.
assert.deepEqual(cidadeUF('(TRAMANDAÍ//RS) UMA CASA NA PRAIA NOVA TRAMANDAÍ'), { cidade: 'Tramandaí', estado: 'RS' });
assert.deepEqual(cidadeUF('PRÉDIO COMERCIAL DE 409 M² NA ENTRADA DE GAROPABA/SC'), { cidade: 'Garopaba', estado: 'SC' });
assert.deepEqual(cidadeUF('ÁREA DE TERRAS, EM FREI ROGÉRIO/SC'), { cidade: 'Frei Rogério', estado: 'SC' });
assert.deepEqual(cidadeUF('SALA COMERCIAL EM CAPINAS - SP COM 89,64M2'), { cidade: null, estado: null }, 'typo não vira cidade');
assert.deepEqual(cidadeUF('CASA EM XANGRI-LÁ/RS'), { cidade: 'Xangri-Lá', estado: 'RS' });
// Hífen colado (24/10, Clóvis): "ALEGRETE- RS" e "CRI DE ROSÁRIO DO SUL-RS" — o IBGE é a prova.
assert.deepEqual(cidadeUF('UM BOX GARAGEM NO EDIFICIO CAMILA, ALEGRETE- RS'), { cidade: 'Alegrete', estado: 'RS' });
assert.deepEqual(cidadeUF('UM APARTAMENTO Nº 302, CONFORME MATR. 5.009 CRI DE ROSÁRIO DO SUL-RS'), { cidade: 'Rosário do Sul', estado: 'RS' });

// cidadeDoCorpo (24/10, 2ª leva RS): título sem cidade → campo "Localização" e o bloco DESCRIÇÃO do lote (textos reais).
assert.deepEqual(cidadeDoCorpo('INFORMAÇÕES DO IMÓVEL keyboard_arrow_down Localização TRAMANDAI / RS CENTRO Endereço RUA BARÃO DO GUAÍBA, 650'),
  { cidade: 'Tramandai', estado: 'RS' }, 'Eduardo Vivian: Localização estruturada');
assert.deepEqual(cidadeDoCorpo('DESCRIÇÃO keyboard_arrow_down CASA DE NÚMERO 97, composta de sala, sito à Rua Lino Estácio dos Santos, número 1535, Oriçó, Gravataí, RS, a saber descrito como: M. 89.148 ÚLTIMOS LANCES 0'),
  { cidade: 'Gravataí', estado: 'RS' }, 'Arnoldo 435: "…, Gravataí, RS" no bloco DESCRIÇÃO');
assert.deepEqual(cidadeDoCorpo('DESCRIÇÃO keyboard_arrow_down UM APARTAMENTO sob nº 106, sito a rua Andrade Neves, na zona urbana desta cidade ÚLTIMOS LANCES 0 Rua dos Andradas, Porto Alegre/RS'),
  { cidade: null, estado: null }, '"desta cidade" não vira cidade, e o rodapé fora do bloco não conta');
assert.deepEqual(cidadeDoCorpo('DESCRIÇÃO keyboard_arrow_down Conforme Matrícula nº 48.580 do RI da Comarca de Cachoeira do Sul/RS. ÚLTIMOS LANCES'),
  { cidade: null, estado: null }, 'Comarca não é a cidade do lote');

// Trevisan (24/10, pendência 356): venda por alienação particular — TODOS os links da listagem terminam em /alienacao
// (href real de www.trevisanleiloes.com.br/leilao/lotes/imoveis). Exigir o id no fim do href enumerava 0 de 27.
const listagemTrevisan = `<a href="/leilao/terreno-de-esquina-232-75m2-em-campo-bom-rs-16-09-2026-15-39-18/lote_id/148/alienacao">ver</a>
<a href="https://x.com/intent/tweet/?text=x&amp;url=http://www.trevisanleiloes.com.br/leilao/x/lote_id/148/alienacao">tw</a>
<a href="/leilao/leffa-comum/lote_id/7208">ver</a>`;
const urlsTrev = extrairUrlsDeLote(listagemTrevisan, 'https://www.trevisanleiloes.com.br');
assert.deepEqual([...urlsTrev.keys()].sort(), ['148', '7208'], 'sufixo /alienacao aceito; link de compartilhar não conta');
assert.equal(urlsTrev.get('148'), 'https://www.trevisanleiloes.com.br/leilao/terreno-de-esquina-232-75m2-em-campo-bom-rs-16-09-2026-15-39-18/lote_id/148/alienacao');
assert.equal(idDaUrl(urlsTrev.get('148')), '148');

// 26/10 (3ª leva das Juntas) — textos REAIS do seco.
// Venda direta: /venda-direta/bem_id/N na MESMA listagem de imóveis, com chave `vd<N>` (bem_id ≠ lote_id).
const listagemVD = `<a href="/leilao/leilao-alienacao-fiduciaria-gdbiosul/lote_id/608">x</a>
<a href="/venda-direta/bem_id/364"><img></a><a href="/venda-direta/bem_id/364">COBERTURA</a>
<a href="/leilao/leilao-simulacao-31-07-2023-17-36-24/lote_id/7">simulação</a>`;
const urlsVD = extrairUrlsDeLote(listagemVD, 'https://agilileiloes.com.br');
assert.deepEqual([...urlsVD.keys()].sort(), ['608', 'vd364'], 'venda direta entra; leilão de SIMULAÇÃO não');
assert.equal(idDaUrl(urlsVD.get('vd364')), 'vd364');
// Agili VD 364: "VALOR R$ 1.300.000,00 COMISSÃO 6% R$ 78.000,00" — a comissão não é preço; data de publicação não é praça.
d = parseDetalhe(pagina('COBERTURA DUPLEX PRAIA DE MARISCAL, BOMBINHAS SANTA CATARINA - Agili Leilões',
  'HOME VENDA DIRETA COBERTURA DUPLEX Disponibilizado em: 28/06/2025 16:04:11 SOLICITAR MAIS INFORMAÇÕES VALOR R$ 1.300.000,00 COMISSÃO 6% R$ 78.000,00 ESTE SITE PRECISA DO JAVASCRIPT HABILITADO PARA FUNCIONAR! Propostas Nenhuma proposta recebida DESCRIÇÃO keyboard_arrow_down Apartamento Duplex nº 04 (204), município de Bombinhas/SC, área real privativa de 12,50m². OBSERVAÇÕES keyboard_arrow_down Faturamento por temporada'),
  'https://agilileiloes.com.br/venda-direta/bem_id/364');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo, d.modalidade, d.data_leilao, d.encerrado], [1300000, 1300000, 'venda_direta', null, false]);
assert.deepEqual([d.cidade, d.estado], ['Bombinhas', 'SC']);
// Lessa VD 297: avaliação declarada ACIMA do preço vale como avaliação.
d = parseDetalhe(pagina('SALA NA RUA ITAPEVA - Mário Lessa Freitas Filho', 'Disponibilizado em: 17/02/2022 12:04:58 VALOR R$ 75.950,00 COMISSÃO 10% R$ 7.595,00 Propostas DESCRIÇÃO keyboard_arrow_down Sala nº 406. Avaliação: R$ 155.000,00 (cento e cinquenta e cinco mil reais). OBSERVAÇÕES'),
  'https://lessaleiloes.com.br/venda-direta/bem_id/297');
assert.deepEqual([d.valor_avaliacao, d.valor_minimo], [155000, 75950]);
// Zuccalmaglio VD 339: "ENCERRA EM ENCERRADO" no bloco do preço = encerrado.
d = parseDetalhe(pagina('X - Zuccalmaglio', 'Disponibilizado em: 07/08/2024 12:14:49 VALOR R$ 500.000,00 COMISSÃO 10% R$ 50.000,00 ENCERRA EM ENCERRADO ENCERRAMENTO 30/07/2025 11:21:00 Propostas DESCRIÇÃO keyboard_arrow_down Casa.'),
  'https://zuccalmaglioleiloes.com.br/venda-direta/bem_id/339');
assert.equal(d.encerrado, true);
// Cecilia Delzeir 515: og:title é o nome do JUÍZO — título e descrição vêm do bloco DESCRIÇÃO.
d = parseDetalhe(pagina('3ª VARA CÍVEL DO FORO DA COMARCA DE SUZANO/SP - Cecilia Delzeir Leilões',
  'LANCE INICIAL 1º LEILÃO R$ 1.791.827,46 LANCE INICIAL 2º LEILÃO R$ 1.254.279,22 DESCRIÇÃO keyboard_arrow_down Um Terreno distando aproximadamente 16 km da cidade de Suzano-SP, encerrando a área de 5.338,09m². OBSERVAÇÕES keyboard_arrow_down x'),
  'https://ceciliadelzeirleiloes.com.br/leilao/x/lote_id/515');
assert.match(d.titulo, /^Um Terreno distando/);
assert.deepEqual([d.cidade, d.estado], ['Suzano', 'SP']);
// Bianchi 1795: corpo só diz "desta cidade de Horizontina" — município de UMA UF no IBGE vira cidade/UF.
assert.deepEqual(cidadeDoCorpo('DESCRIÇÃO keyboard_arrow_down IMÓVEL: TERRENO URBANO NO 15, sito na Vila São José, zona Sul, desta cidade de Horizontina, com as seguintes confrontações. ÚLTIMOS LANCES'),
  { cidade: 'Horizontina', estado: 'RS' });

// CIDADE DO SLUG (26/10, URLs REAIS de Luci Vera e Santayana): lote "CASA"/"TERRENO COM ÁREA…" sem cidade no texto.
const sl = (u) => { const r = cidadeDoSlugLeilao(u); return [r.cidade, r.estado]; };
assert.deepEqual(sl('https://www.luciverareisleiloes.com.br/leilao/imovel-porto-alegre-rs-25-09-2026-16-21-36/lote_id/3165/alienacao'), ['Porto Alegre', 'RS']);
assert.deepEqual(sl('https://www.santayanaleiloes.com.br/leilao/terreno-no-loteamento-residencial-colina-ritzel-em-campo-bom-rs-25-09-2026-16-31-13/lote_id/10411/alienacao'), ['Campo Bom', 'RS']);
assert.deepEqual(sl('https://www.luciverareisleiloes.com.br/leilao/comarca-de-crissiumal-rs-imovel-humaita-rs/lote_id/3176'), ['Humaita', 'RS'], 'o par mais perto do fim: o bem, não a comarca');
assert.deepEqual(sl('https://www.luciverareisleiloes.com.br/leilao/comarca-de-crissiumal-imovel-rural-02-09-2026-15-46-11/lote_id/3135'), [null, null], 'comarca sem UF não é a cidade do bem');
assert.deepEqual(sl('https://www.santayanaleiloes.com.br/leilao/imovel-onde-atualmente-funciona-a-empresa-beto-pizzaria-localizado-na-rodovia-sc-434-em-garopaba-25-09-2026-16-52-45/lote_id/10412/alienacao'), ['Garopaba', 'SC'], '"em <cidade>" no fim, nome de uma UF só');
assert.deepEqual(sl('https://www.swleiloes.com.br/venda-direta/bem_id/152'), [null, null]);

console.log('leilaopro-preco-e-cidade: todos os casos passaram');
