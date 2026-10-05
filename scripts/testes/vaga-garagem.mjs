// Regra acervo.vaga_garagem (dono, 05/10): sai o lote que É vaga/box; unidade COM vaga fica. Títulos REAIS do
// acervo. Espelho SQL: vaga_garagem_barrada() — a paridade foi medida em 431/431 lotes reais no dia da regra.
import assert from 'node:assert/strict';
import { ehVagaGaragem, checarQualidade } from '../lib/scraper-core.mjs';

const sai = [
  'Vaga de Garagem 18 m² (Edifício Jardim Etoile) - Aclimação - São Paulo - SP',
  'Box 32 c/ 12,48 m² - R. Tomé de Souza - 355 - B. Pátria Nova',
  'Vagas de garagem em Ponte Nova/MG',
  'Oportunidade: Garagem 15m² em Leilão - Presidente Prudente/SP',
  '03 Vagas de Garagem EDIFICIO COSTA DEL SOL na Rua Tijuco Preto, bairro Tatuapé, São Paulo/SP',
  'UMA VAGA DE GARAGEM NO RESIDENCIAL PARQUE DOS PÁSSAROS EM ARAXÁ/MG',
  'SP - São Vicente - Itararé | Box de garagem - 18 m²',
  'BOX Nº 07 e 08, do edificio situado na Rua Moema, 360, bairro Chacara das Pedras, Porto Alegre/RS',  // "Chácara" é bairro
  'Vaga Dupla nº 214/247 c/ 25,00m² - Guarulhos/SP',
];
for (const titulo of sai) assert.equal(ehVagaGaragem({ titulo, descricao: '' }), true, `devia sair: ${titulo}`);

const fica = [
  ['APARTAMENTO DE 383,418M² E 6 VAGAS DE GARAGEM NO CONDOMÍNIO CASTELBIANCO EM HIGIENÓPOLIS/SP', ''],
  ['Apto 204 - 43,07 m² - Vg de garagem - Três Lagoas/MS', ''],
  ['Direitos sobre Sala Comercial 64 m² e Box 12 m² (Unid. 19 do Edifício Paladium)', ''],
  ['Cobertura 61 c/ 242,98m² - Box c/ 24m² - Centro', ''],
  ['Conjunto com 130,15m² e Box de estac. - Auxiliadora', ''],
  ['Com Vagas em Curitiba/PR - Lote 1', 'Com Vagas em Curitiba/PR · avaliação R$ 2.017.927,86'],
  // SUBLIME: título começa pelos atributos — área e descrição provam que é apartamento
  ['2 Vagas | Área privativa 166m² | Área total 281m² - Cubatão/SP', 'APARTAMENTO DUPLEX SOB N° 82, localizado no 8º andar'],
  ['Vaga | 90m² útil - São Paulo/SP', 'MATRÍCULA: DIREITOS AQUISITIVOS SOBRE O APARTAMENTO Nº 44, localizado no 4º andar'],
];
for (const [titulo, descricao] of fica) assert.equal(ehVagaGaragem({ titulo, descricao }), false, `devia ficar: ${titulo}`);

// No funil do coletor: descarte permanente com motivo próprio (o runner tira do ar o já gravado).
const q = checarQualidade({ titulo: 'Box nº 202 - 12,00m² - Centro Histórico', valor_minimo: 30000, modalidade: 'judicial' }, { estrito: false });
assert.deepEqual([q.descartar, q.faltando], [true, ['vaga_garagem']]);
console.log('vaga-garagem: todos os casos passaram');
