/**
 * scripts/testes/area-em-hectares.mjs — 29/09. `extrairAreaM2` só entendia m²; rural anunciado em
 * hectare ficava sem área. Trechos REAIS do acervo (lote_sem_area_nem_matricula). Ver
 * `areaEmHectares` em api/_texto-imovel.js.
 */
import { extrairAreaM2 } from '../../api/_texto-imovel.js';

let falhas = 0;
const eq = (txt, esperado, opts) => {
  const v = extrairAreaM2(txt, opts);
  const ok = Math.abs(v - esperado) < 0.01;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗'} ${JSON.stringify(txt).slice(0, 70)} → ${v}${ok ? '' : ` (esperado ${esperado})`}`);
};

console.log('\nárea em hectares');
eq('FAZENDA DE 133,42 HECTARES SITUADA ÀS MARGENS DA BR050', 1334200);
eq('50% dos Direitos - Chácara 41,61ha - Santana do Araguaia/PA', 416100);
eq('IMÓVEL RURAL COM ÁREA ÚTIL DE 10,088463 ha, EM CERRO NEGRO-SC', 100884.63);
eq('FAZENDA PALMEIRA COM 2.00.10 HECTARES NA ZONA RURAL', 20010);
eq('FAZENDA REGINA COELI DE 244 HECTARES PRÓXIMA AO DISTRITO', 2440000);
eq('Fazenda com 1.234 ha em Mato Grosso', 12340000);
eq('Sítio de 58 alqueires em Palmital/PR', 0);                        // alqueire: região decide, não converte
eq('Sítio com 16,94 hectares; sede com 120,00 m² de área construída', 120); // m² rotulado vence
eq('Página inteira: Fazenda 10 ha', 0, { permitirSolta: false });    // página inteira não aceita solta
eq('Terreno com 360,00m²', 360);                                       // m² segue igual

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
