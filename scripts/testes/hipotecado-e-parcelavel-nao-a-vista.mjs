/**
 * scripts/testes/hipotecado-e-parcelavel-nao-a-vista.mjs — `hipotecado` NUNCA é "só à vista".
 *
 * POR QUE EXISTE (31/08, achado do dono num print). Um apartamento no Itaim Bibi aparecia
 * classificado como **Hipotecado** e a projeção financeira do mesmo relatório saía **à vista**.
 *
 * O nome engana quem lê o código de fora, e foi isso que criou o bug: nesta base `hipotecado`
 * NÃO é um ônus, é uma FORMA DE PAGAMENTO parcelável. Quem grava é o gatilho
 * `default_forma_pagamento_judicial`, que marca todo lote judicial assim, e o filtro da Busca
 * descreve o valor por extenso: "Parcelamento no leilão judicial (art. 895 do CPC), com o
 * imóvel hipotecado ao juízo até quitar".
 *
 * Duas telas decidiam à vista com `!pagamento.includes('financiado')` e nenhuma conhecia
 * `hipotecado` — então TODO lote judicial era tratado como só-à-vista, com o cenário parcelado
 * desabilitado e capital, custo mensal, ROI e teto de lance sobre a premissa errada.
 * Medido no dia: 2.081 lotes ativos, os 2.081 judiciais.
 *
 * A armadilha inversa também é travada aqui: `null` significa "não sabemos", e não sabemos
 * nunca pode virar restrição.
 */
import { soAceitaAVista } from '../../src/data/pagamento.js';

const casos = [
  // ── NÃO é só à vista ────────────────────────────────────────────────────────────────
  [['hipotecado'], false, 'hipotecado = parcelavel por art. 895 (o caso do print)'],
  [['financiado'], false, 'financiado'],
  [['hipotecado', 'a_vista'], false, 'uma forma parcelavel basta para liberar o cenario'],
  [['financiado', 'hipotecado'], false, 'as duas parcelaveis'],
  [null, false, 'sem informacao NAO restringe ("nao sabemos" nao vira "so a vista")'],
  [[], false, 'lista vazia idem'],
  [[null], false, 'lista so com nulo idem'],
  ['hipotecado', false, 'aceita string solta, nao so array'],
  [['HIPOTECADO'], false, 'caixa alta nao pode escapar'],

  // ── É só à vista ────────────────────────────────────────────────────────────────────
  [['a_vista'], true, 'a_vista explicito'],
  ['a_vista', true, 'a_vista como string'],
];

let mau = 0;
for (const [entrada, esperado, oque] of casos) {
  const got = soAceitaAVista(entrada);
  const ok = got === esperado;
  if (!ok) mau++;
  console.log(`${ok ? '  ok  ' : '  FALHOU '} ${JSON.stringify(entrada)} → ${got} (esperado ${esperado}) · ${oque}`);
}

if (mau) {
  console.error(`\n❌ ${mau} caso(s) fora do esperado em soAceitaAVista.`);
  process.exit(1);
}
console.log(`\n✅ ${casos.length} casos: lote judicial/hipotecado mantém o cenário parcelado.`);
