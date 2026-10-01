// 01/10 — "Terreno de 1.201.00m²" (APICE): milhar E decimal com ponto gravava 201 (a leitura solta
// começava no meio do número). Invariante area_truncada_no_milhar acusou.
import { extrairAreaM2 } from '../../api/_texto-imovel.js';
const casos = [
  ['Terreno de 1.201.00m²', 1201], ['área de 2.345.50 m²', 2345.5], ['Casa de 480,00m² em Terreno de 1.201.00m²', 480],
  ['58.255m²', 58255], ['1.234,56 m²', 1234.56], ['Área Terreno: 260.00 m²', 260], ['área total 300 m²', 300],
];
let falhas = 0;
for (const [t, esperado] of casos) { const v = extrairAreaM2(t); if (v !== esperado) { falhas++; console.error('FALHOU', JSON.stringify(t), '→', v, 'esperado', esperado); } }
if (falhas) process.exit(1);
console.log(`✓ área com milhar e decimal com ponto: ${casos.length} casos`);
