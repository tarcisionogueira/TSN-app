// 01/10 — "Terreno de 1.201.00m²" (APICE): milhar E decimal com ponto gravava 201 (a leitura solta
// começava no meio do número). Invariante area_truncada_no_milhar acusou.
import { extrairAreaM2, numeroArea } from '../../api/_texto-imovel.js';
const casos = [
  ['Terreno de 1.201.00m²', 1201], ['área de 2.345.50 m²', 2345.5], ['Casa de 480,00m² em Terreno de 1.201.00m²', 480],
  ['58.255m²', 58255], ['1.234,56 m²', 1234.56], ['Área Terreno: 260.00 m²', 260], ['área total 300 m²', 300],
];
let falhas = 0;
for (const [t, esperado] of casos) { const v = extrairAreaM2(t); if (v !== esperado) { falhas++; console.error('FALHOU', JSON.stringify(t), '→', v, 'esperado', esperado); } }
// 28/10 (#375): `numeroArea` é a regra que os leitores de área dos coletores passaram a usar. Antes, "195.66" (SUPERBID)
// virava 19.566 — o leitor de R$ apagava todo ponto.
const numeros = [['195.66', 195.66], ['216.0', 216], ['52.49', 52.49], ['1.302', 1302], ['21.404', 21404], ['1.302,50', 1302.5],
  ['47,835', 47.835], ['1.201.00', 1201], ['33.434.00', 33434], ['300', 300], ['', 0], ['abc', 0]];
for (const [s, esperado] of numeros) { const v = numeroArea(s); if (v !== esperado) { falhas++; console.error('FALHOU numeroArea', JSON.stringify(s), '→', v, 'esperado', esperado); } }
if (falhas) process.exit(1);
console.log(`✓ área com milhar e decimal com ponto: ${casos.length} casos + numeroArea ${numeros.length}`);
