// Regra acervo.fracao_ideal (scripts/lib/scraper-core.mjs · espelho SQL fracao_ideal_barrada).
// Textos REAIS. Apartamento inteiro com a cláusula cartorial de condomínio NÃO pode ser barrado;
// venda de fatia (parte ideal, fração de terreno sem condomínio) SEMPRE barra.
import assert from 'node:assert/strict';
import { ehFracaoIdeal } from '../lib/scraper-core.mjs';

const passa = [
  // Sublime lote 3427 (27/09) — terreno ANTES da âncora (3ª ordem)
  'com uma área útil e privativa de 86,41 metros quadrados, uma área comum de 14,683 metros quadrados, perfazendo a área total de 101,093 metros quadrados, correspondendo no terreno uma fração ideal de 0,004130 ou 0,4130%; cabendo-lhe o direito ao uso exclusivo',
  // ordens já documentadas no código (28/08)
  'apartamento com área privativa de 60 m² e a fração ideal de 1,79088% no terreno e demais coisas comuns do condomínio',
  'unidade autônoma, fração ideal no terreno de 0,31413500%, área privativa 70 m²',
];
// Fração numérica só conta no TÍTULO (03/10): na descrição, "1/20 do terreno" é cota de condomínio.
assert.equal(ehFracaoIdeal({ titulo: 'Apartamento em Copacabana/RJ', descricao: 'com direito a uma vaga de garagem individual, e 1/20 do terreno, que mede na sua totalidade 15m' }), false, 'cota de terreno na descrição não barra');
assert.equal(ehFracaoIdeal({ titulo: 'Casa 3/4 dorm. em Salvador/BA', descricao: '' }), false, '"3/4" de quartos não é fração');
assert.equal(ehFracaoIdeal({ titulo: 'Leilão 12/10/2026 do imóvel em Itu', descricao: '' }), false, 'data não é fração');
for (const d of passa) assert.equal(ehFracaoIdeal({ titulo: 'Apartamento', descricao: d }), false, `não devia barrar: ${d.slice(0, 60)}`);

const barra = [
  { titulo: '50% de uma área em Vera Cruz', descricao: 'Parte ideal correspondente a 50% do imóvel' },
  { titulo: 'Terreno', descricao: 'venda da fração ideal de 25% do terreno rural' },
  { titulo: 'Fração ideal de apartamento', descricao: 'área privativa de 50 m²' },
  // 03/10 — títulos reais com a fração em número
  { titulo: '(2/9 do imóvel) Galpão, A.C. 749m², Centro, Itajobi/SP', descricao: '' },
  { titulo: '(2/9 do imóvel) Barracão Comercial, A.T. 1.020m²,  escritório, WC, Centro, Itajobi/SP', descricao: '' },
  { titulo: '1/6 do Prédio Coml c/ 380m² - Terreno 222,80m² -São Paulo/SP', descricao: '' },
  // 05/10 — DBS (Astavero): o conector "de um" não era aceito
  { titulo: '1/9 de Um Imóvel Urbano, Anita Garibaldi - SC', descricao: 'Fração de 1/9 de UM IMÓVEL URBANO, terreno registrado com área de 1.001,12m²' },
  { titulo: 'Imóvel', descricao: 'nua-propriedade do imóvel, área privativa 80 m², fração ideal de 2% no terreno' },
];
for (const im of barra) assert.equal(ehFracaoIdeal(im), true, `devia barrar: ${im.titulo}`);

// 08/10 — descrições COMPLETAS da ZUK/MEGA (textos reais). Unidades inteiras que a v3 barrava:
const passaV4 = [
  { titulo: 'Casa 236 m² - Centro - Ituiutaba - MG', descricao: 'Casa. Matrícula nº 14.224. Vendedor: Santiago Fundo de Investimento em Direitos Creditórios.' },
  { titulo: 'Apartamento 181 m²', descricao: 'Área de uso comum 241,39m²; Área total construída 545,87m²; Fração ideal 8,2881%. Matr. 197.667' },
  { titulo: 'Apartamento 58 m² (02 vagas)', descricao: 'vagas de garagem nº 93 e 93 A e respectivas frações ideais do terreno, situado à Rua Parambú' },
  { titulo: 'Imóvel Comercial 68 m² (Loja e Sobreloja 06)', descricao: 'área real global, ocupando 1,98% de fração ideal do terreno, loja' },
  { titulo: 'Casa 565 m²', descricao: 'CASA. constr. 485,25m², fração ideal 10/660 do domínio útil do respectivo terreno. Matr. 27.385' },
  { titulo: 'Casa 96 m² - Brotas', descricao: 'Área terreno: 60,00m² (fração ideal); Área construída/privativa: 96,00m².' },
  { titulo: 'Apartamento 62 m²', descricao: 'Área construída privativa (matrícula): 49,00m²; Fração ideal (matrícula): 27,5%;' },
  { titulo: 'Apartamento em leilão - Rua Cel. Arthur Gomes', descricao: 'apartamento com área privativa de 98,67m² e cada vaga 3,50m², com as frações ideais de 44,39m², 1,53m² e 1,53m² do terreno próprio' },
  { titulo: 'Casa Duplex nº 840 c/ 95,58m²', descricao: 'Casa Duplex nº 840, c/ fração ideal de 50,00%, entrada independente, c/ área construída de 95,58m²' },
];
for (const im of passaV4) assert.equal(ehFracaoIdeal(im), false, `não devia barrar (v4): ${im.titulo}`);
// …e as fatias reais do mesmo dia continuam barradas, com número e tudo:
const barraV4 = [
  { titulo: 'Fazenda Marques — São Sebastião', descricao: 'Bem(ns): JB0007833 [Fração ideal de 33,33% sobre] imóvel rural área total de 13,33,36 ha' },
  { titulo: 'Rua João Laurente, 57', descricao: '[Fração ideal de 1/3 sobre] casa com 3 quartos no Vila Cruzeiro do Sul' },
  { titulo: 'Imóvel', descricao: 'venda das frações ideais de 50% do imóvel, área construída 120m²' },
  { titulo: 'Avenida Antônio Araújo, 852', descricao: 'correspondente a 48,33% da cota ideal da construção e 83,48% da fração ideal do terreno' },
  { titulo: 'Casa em leilão - Rua Acácio Vieira de Camargo, 425', descricao: 'Parte Ideal (50%) - Casa, situada à Rua Acacio Vieira de Camargo, Condomínio Residencial' },
  { titulo: 'Apartamento 67 m² e 02 Vagas', descricao: 'fração ideal de terreno de 1,1759%. Consta na Av.06 a penhora exequenda da parte ideal (50%) do imóvel' },
];
for (const im of barraV4) assert.equal(ehFracaoIdeal(im), true, `devia barrar (v4): ${im.titulo}`);

console.log('fracao-ideal: todos os casos passaram');

// 24/10 — porcentagem do bem no TÍTULO (decisão do dono). Títulos reais do acervo ativo:
for (const t of ['20% do imóvel com 300 m² - São Lucas - Belo Horizonte', '50% de Um Apartamento - Vila Prudente - Sp',
  'COTA PARTE DE 5% DA CASA GEMINADA "CONDOMÍNIO RESIDENCIAL VISTA BELA', 'DIREITOS de 37,499% do TERRENO com 4,196 alqueires',
  'LOTE 001: 10% (DEZ POR CENTO) DO TERRENO E CONSTRUÇÕES DO IMOVEL', '50% DO IMÓVEL RURAL MEDINDO 26.210,945M²'])
  assert.equal(ehFracaoIdeal({ titulo: t, descricao: '' }), true, `devia barrar: ${t}`);
for (const t of ['100% do imóvel residencial, 143m²', 'Casa com 50% de desconto - Centro', 'Apartamento 2 dorm. 30% abaixo da avaliação'])
  assert.equal(ehFracaoIdeal({ titulo: t, descricao: '' }), false, `não devia barrar: ${t}`);
assert.equal(ehFracaoIdeal({ titulo: 'Casa em Ituiutaba', descricao: 'reservada a meação de 50% do imóvel ao cônjuge' }), false, 'na descrição não barra');
console.log('ok — porcentagem do bem no título');

// 28/10 — v5: "parte ideal de N m² nas áreas comuns/terreno" é cláusula de condomínio (ALLIANCE 470, apartamento inteiro).
assert.equal(ehFracaoIdeal({ titulo: 'Apartamento - São Vicente - Rua Benedito Calixto, 21', descricao: 'correspondendo a este apartamento a fração ideal de 0,0211, significando medir esta unidade autônoma aproximadamente 106, 00m², correspondendo-lhe uma parte ideal de 23,525m², nas áreas de uso comum, inalienáveis e indivisíveis e no terreno sobre o qual se acha construído o edifício.' }), false, 'v5: parte ideal em m² nas áreas comuns não barra');
// …mas parte ideal em %, fração ou hectare continua barrada (textos reais dos 80 barrados medidos em 28/10):
for (const d of ['Parte ideal de 50% do lote urbano nº 23-B, com área total de 168,00m², sem benfeitorias.', 'Parte Ideal de 3,33% sobre Terreno 400 m² - Jardim Pérola - Birigui - SP',
  'Parte ideal de 3,19has - Goiatuba/GO', 'Parte ideal de 50% de Terreno c/ 6.589,03m² - Serra/ES'])
  assert.equal(ehFracaoIdeal({ titulo: 'Imóvel', descricao: d }), true, `v5: devia barrar: ${d}`);
console.log('ok — v5 (parte ideal em m²)');

