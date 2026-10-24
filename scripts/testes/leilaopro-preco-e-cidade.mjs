// LeilãoPro (24/10, tenants das Juntas Comerciais): textos REAIS das páginas lidas no seco.
//  - preço: o "LANCE INICIAL" sem número é o lance VIGENTE do card; não pode vencer o rótulo numerado do 1º leilão
//    (Renovar 10335), e sem 2º leilão, abaixo da avaliação, ele é o mínimo (Raupp 6457). "1ª/2ª DATA" = 1º/2º leilão (NS).
//  - cidade: o og:title termina com o nome do site ("… - JAC Leilões | Site do leiloeiro oficial de Cascavel/PR") e
//    o Cascavel/PR do LEILOEIRO virava a cidade do lote; "Cidade - UF" no título só vale com prova do IBGE.
import assert from 'node:assert/strict';
import { parseDetalhe, cidadeUF } from '../lib/leilaopro-parse.mjs';

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
console.log('leilaopro-preco-e-cidade: todos os casos passaram');
