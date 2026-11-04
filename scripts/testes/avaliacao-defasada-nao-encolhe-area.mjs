// Caso Porto Trapiche (04/11): 4 apartamentos unificados, 700 m², 5 suítes, comparáveis do próprio prédio a
// ~R$ 32 mil/m² e avaliação a R$ 6,5 mil/m². A trava dizia "área provável total, ~136 m² privativos".
import { areaCorroborada, fatorArea, areaMedianaComparaveis, quartosDoTexto, matriculasDoTexto, matriculaParcial } from '../../api/_area-coerencia.js';
let falhas = 0;
const ok = (c, o, x = '') => { if (c) console.log(`  ✓ ${o}`); else { falhas++; console.log(`  ✗ ${o}${x ? ` — ${x}` : ''}`); } };
const trapiche = 'Apartamento nº 114 do Edifício Porto Trapiche Residence, correspondente à unificação dos apartamentos 111, 112, 113 e 114, com área total aproximada de 700 m². A descrição contempla salas de estar e jantar, cinco quartos com suítes, dois lavabos';
ok(quartosDoTexto(trapiche) === 5, `lê "cinco quartos" (veio ${quartosDoTexto(trapiche)})`);
ok(areaCorroborada({ texto: trapiche, areaPrivImplicita: 136 }).corroborada, 'Trapiche: área corroborada (unificação + 5 quartos)');
// Campinas (SUPERBID, 04/11): "Apartamento com 139 m², 1 Vaga" — a trava deve continuar valendo.
ok(!areaCorroborada({ texto: 'Apartamento com 139 m², 1 Vaga - Parque das Constelações, Campinas/SP. Área Total: 139.0 m2', areaPrivImplicita: 40 }).corroborada, 'Campinas: sem quartos nem unificação, a trava segue');
ok(!areaCorroborada({ texto: 'Apartamento com 2 quartos, 121 m² de área total', areaPrivImplicita: 64 }).corroborada, '2 quartos em 64 m² implícitos é plausível: trava segue');
const vendas = [{ valor: 3000000, valorM2: 31914.89 }, { valor: 3500000, valorM2: 31818.18 }, { valor: 4200000, valorM2: 43298.97 }, { valor: 3100000, valorM2: 28181.82 }, { valor: 3500000, valorM2: 31818.18 }];
const am = areaMedianaComparaveis(vendas);
ok(am >= 94 && am <= 110, `área mediana dos comparáveis ~100 m² (veio ${am})`);
const f = fatorArea(am, 700);
ok(f > 0.55 && f < 0.7, `fator de área NBR para 700 m² × ~${am} m² ≈ 0,62 (veio ${f})`);
const valor = Math.round(33406.41 * f * 700);
ok(valor > 12e6 && valor < 16e6, `valor ≈ 4 unidades de ~R$ 3,5 mi (veio R$ ${valor.toLocaleString('pt-BR')})`);
ok(fatorArea(100, 110) === 1 && fatorArea(200, 100) === 1, 'diferença < 30% ou avaliando menor: fator 1 (nunca infla)');
// Documentos do leiloeiro (04/11): matrícula 24.421 = apto 111, 92,80 m² privativos — UMA das quatro unidades.
const pag = 'Matrícula: 24.374 (apt. 114), 24.421 (apt. 111), 24.422 (apt. 112) e 24.423 (apt. 113) – 4º Ofício';
ok(matriculasDoTexto(pag).length === 4, `lê as 4 matrículas sem confundir nº de apartamento (veio ${matriculasDoTexto(pag).join(',')})`);
ok(matriculaParcial({ texto: trapiche + ' Matrículas nº 24.374, 24.421, 24.422 e 24.423', areaMatricula: 92.8, areaAnuncio: 700 }).parcial, '92,80 m² de UMA matrícula não substitui os 700 m² do lote');
ok(!matriculaParcial({ texto: 'Matrícula: 148217', areaMatricula: 45, areaAnuncio: 139 }).parcial, 'lote de matrícula única: a matrícula continua mandando');
ok(!matriculaParcial({ texto: 'Matrículas 1.111 e 2.222', areaMatricula: 650, areaAnuncio: 700 }).parcial, 'várias matrículas com área compatível: a matrícula continua mandando');
console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ todos os casos passaram');
process.exit(falhas ? 1 : 0);
