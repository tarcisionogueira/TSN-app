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
for (const d of passa) assert.equal(ehFracaoIdeal({ titulo: 'Apartamento', descricao: d }), false, `não devia barrar: ${d.slice(0, 60)}`);

const barra = [
  { titulo: '50% de uma área em Vera Cruz', descricao: 'Parte ideal correspondente a 50% do imóvel' },
  { titulo: 'Terreno', descricao: 'venda da fração ideal de 25% do terreno rural' },
  { titulo: 'Fração ideal de apartamento', descricao: 'área privativa de 50 m²' },
  { titulo: 'Imóvel', descricao: 'nua-propriedade do imóvel, área privativa 80 m², fração ideal de 2% no terreno' },
];
for (const im of barra) assert.equal(ehFracaoIdeal(im), true, `devia barrar: ${im.titulo}`);

console.log('fracao-ideal: todos os casos passaram');
