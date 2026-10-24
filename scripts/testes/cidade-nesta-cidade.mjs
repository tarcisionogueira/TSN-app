// #310 (24/10): "situado NESTA CIDADE" + "Cartório de Registro de Imóveis de X (UF)" — a cidade do lote é a do
// próprio registro. Página REAL do CASSIANO (fixture), que saía sem cidade/UF. E as recusas: sem o "nesta cidade"
// o cartório (comarca) NÃO vira cidade — a mesma cautela do NAKAKOGUE com o juízo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cidadeNestaCidade } from '../lib/dom-parse-util.mjs';
import { parseDetalhe } from '../lib/cassiano-parse.mjs';

const URL_LOTE = 'https://www.leiloesbrasilcassiano.com.br/leiloes/lote/em-favor-de-zema-administradora-de-consorcio-ltda-credora-fiduciaria-sendo-a-responsabilidade-do-pagamento-em-nome-de-anielle-lorene-silva-araujo-devedora-fiduciante/';
const html = readFileSync(new URL('./fixtures/cassiano-lote-nesta-cidade.html', import.meta.url), 'utf8');
const det = parseDetalhe(html, URL_LOTE);
assert.equal(det.cidade, 'Uberlândia');
assert.equal(det.estado, 'MG');
assert.equal(det.valor_minimo, 310000);
assert.equal(det.data_leilao, '2026-11-03');
assert.match(det.titulo, /Nesta Cidade/i);   // o título continua sendo a 1ª oração; quem conserta a cidade é o campo

// Formas do helper.
assert.deepEqual(cidadeNestaCidade('Lote situado nesta cidade, Jardim X; matrícula 123 do Registro de Imóveis de São José do Rio Preto/SP.'),
  { cidade: 'São José do Rio Preto', estado: 'SP' });
assert.deepEqual(cidadeNestaCidade('Imóvel neste município, objeto da matrícula 9 do Registro Geral de Imóveis da Comarca de Londrina, PR'),
  { cidade: 'Londrina', estado: null });
// Recusas: sem "nesta cidade" não infere (comarca cobre vários municípios); sem cartório, nada.
assert.deepEqual(cidadeNestaCidade('Terreno no Jardim Everest, matrícula 5 do 1º Registro de Imóveis de Londrina/PR'), { cidade: null, estado: null });
assert.deepEqual(cidadeNestaCidade('Um terreno situado nesta cidade, no bairro Água da Onça'), { cidade: null, estado: null });

console.log('cidade-nesta-cidade: todos os casos passaram');
