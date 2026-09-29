/**
 * scripts/testes/coordenadas-do-texto.mjs — 29/09. Coordenada de imóvel rural a partir dos vértices
 * transcritos da matrícula (scripts/lib/coordenadas-do-texto.mjs).
 */
import { coordenadasDoTexto, distanciaKm } from '../lib/coordenadas-do-texto.mjs';

let falhas = 0;
const perto = (a, b, tol = 0.0005) => a != null && Math.abs(a - b) < tol;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

console.log('\ncoordenadas do texto');
let r = coordenadasDoTexto(`inicia no vértice V-01, de coordenadas 21°12'34,56"S e 47°45'12,34"W; segue até o vértice V-02 (21°12'40,00"S, 47°45'20,00"W)`);
ok(r && perto(r.lat, -21.2104) && perto(r.lng, -47.7550, 0.001), `GMS com hemisfério → ${r?.lat}, ${r?.lng}`);
r = coordenadasDoTexto(`Latitude 5°10'00" N, Longitude 60°40'00"`);
ok(r && r.lat > 0 && r.lng < 0, 'hemisfério Norte (Roraima) fica positivo');
r = coordenadasDoTexto('Coordenadas: -15.793889, -47.882778 (sede)');
ok(r && perto(r.lat, -15.793889) && perto(r.lng, -47.882778), 'decimal');
r = coordenadasDoTexto(`V1 21°12'34"S 47°45'12"W · V2 21°12'35"S 47°45'13"W · V3 21°12'36"S 47°45'14"W · V4 21°59'59"S 47°45'15"W`);
ok(r && perto(r.lat, -21.2097, 0.001), 'mediana ignora o vértice fora da curva');
ok(coordenadasDoTexto('Área de 12,5 ha, matrícula 12.345') === null, 'sem coordenada → null');
ok(coordenadasDoTexto('E=345.678,90 m e N=7.654.321,00 m (UTM 23S)') === null, 'UTM sem fuso não vira coordenada');
ok(Math.abs(distanciaKm({ lat: -23.55, lng: -46.63 }, { lat: -22.90, lng: -47.06 }) - 84.6) < 0.5, 'distância SP–Campinas ≈ 84,6 km');

ok(coordenadasDoTexto(`segue no rumo 25°59'37 até o marco, deflete 50°30'12 à direita`) === null, 'rumo de perímetro com vértice único e sem rótulo → null');
ok(coordenadasDoTexto(`rumo 21°10'00 e 45°20'00, depois 21°11'00 e 46°00'00, depois 21°12'00 e 47°00'00`) === null, 'revisão 29/09: vários rumos sem rótulo → null');

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
