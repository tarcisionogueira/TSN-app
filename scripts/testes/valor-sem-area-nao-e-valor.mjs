/**
 * npm run testar:valor-sem-area — numa base por m², sem área o valor da IA é descartado (03/11).
 * Caso real: análise a3ce7044, sala comercial em BH sem metragem, IA disse R$ 451.000 com avaliação de R$ 100.000.
 */
import { valorDaIaUtilizavel } from '../../src/lib/valor-sem-area.js';

let falhas = 0;
const ok = (cond, oque, extra) => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`); }
};

const sala = valorDaIaUtilizavel({ valorIa: 451000, areaM2: 0, baseTipo: 'comercial' });
ok(sala.valor === 0, 'sala comercial sem área: valor da IA (R$ 451 mil) não vira valor de mercado', sala);
ok(sala.descartado?.valorIa === 451000 && sala.descartado.motivo === 'area_desconhecida', 'o número recusado fica registrado com o motivo', sala.descartado);
ok(valorDaIaUtilizavel({ valorIa: 300000, areaM2: null, baseTipo: 'residencial' }).valor === 0, 'apartamento/casa sem área: idem');
ok(valorDaIaUtilizavel({ valorIa: 300000, areaM2: 60, baseTipo: 'residencial' }).valor === 300000, 'com área conhecida, o valor da IA segue valendo');
ok(valorDaIaUtilizavel({ valorIa: 800000, areaM2: 0, baseTipo: 'terreno' }).valor === 800000, 'terreno (régua própria) não é afetado');
ok(valorDaIaUtilizavel({ valorIa: 50000, areaM2: 0, baseTipo: 'unidade' }).valor === 50000, 'vaga/unidade (sem m²) não é afetada');
ok(valorDaIaUtilizavel({ valorIa: 0, areaM2: 0, baseTipo: 'comercial' }).descartado === null, 'sem número da IA, nada a descartar');

console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ todos os casos passaram');
process.exit(falhas ? 1 : 0);
