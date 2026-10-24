// LeilãoPro (24/10, tenants das Juntas Comerciais): textos REAIS das páginas lidas no seco.
//  - preço: o "LANCE INICIAL" sem número é o lance VIGENTE do card; não pode vencer o rótulo numerado do 1º leilão
//    (Renovar 10335), e sem 2º leilão, abaixo da avaliação, ele é o mínimo (Raupp 6457). "1ª/2ª DATA" = 1º/2º leilão (NS).
//  - cidade: o og:title termina com o nome do site ("… - JAC Leilões | Site do leiloeiro oficial de Cascavel/PR") e
//    o Cascavel/PR do LEILOEIRO virava a cidade do lote; "Cidade - UF" no título só vale com prova do IBGE.
import assert from 'node:assert/strict';
import { parseDetalhe, cidadeUF, cidadeDoCorpo, extrairUrlsDeLote, idDaUrl } from '../lib/leilaopro-parse.mjs';

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

console.log('leilaopro-preco-e-cidade: todos os casos passaram');
