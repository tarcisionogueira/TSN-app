/**
 * npm run testar:fipe — marca/modelo pelo título, estreitamento de candidatos e cache de
 * respostas (api/_fipe.js, 24/09). API simulada: nenhum teste aqui gasta cota da FIPE.
 */
import { marcaModeloDoTitulo, acharCandidatosModelo, criarFipeFetch, buscarFipe } from '../../api/_fipe.js';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };

console.log('\nMARCA/MODELO PELO TÍTULO');
const mm = (t, m) => marcaModeloDoTitulo(t, m);
ok(mm('HONDA CG 160 FAN 2021 2022 AZUL')?.modelo === 'cg 160 fan', 'SUPERBID: modelo termina no ano');
ok(mm('VW/GOL CLI – 96/96 – Catanduva/SP')?.marca === 'volkswagen', 'VW vira Volkswagen (nome da FIPE)');
ok(mm('GM/CORSA WIND – 95/95')?.marca === 'chevrolet', 'GM vira Chevrolet');
ok(mm('Marca: FORD / Modelo: KA SE 1.0')?.modelo.startsWith('ka'), '"Marca: X / Modelo: Y" pula os rótulos');
ok(mm('BIZ 125 ES - HONDA, 2007/2008, CINZA')?.modelo === 'biz 125 es', 'modelo ANTES da marca');
ok(mm('SUCATA PARA PRENSA/HONDA/BIZ (AZUL)')?.modelo.startsWith('biz'), 'prefixo "sucata para prensa" não é modelo');
ok(mm('MERCEDES-BENZ Sprinter')?.modelo === 'sprinter', '"benz" não vira modelo');
ok(mm('SUCATA PARA PRENSA/YAMAHA') === null, 'só a marca: sem modelo (não chuta)');
ok(mm('BOMBA A VÁCUO A70W') === null, 'sem marca conhecida: null');
ok(mm('HONDA CG 125 FAN 2008', 'HONDA')?.marca === 'HONDA', 'marca da fonte é preservada quando existe');

console.log('\nCANDIDATOS DE MODELO (cada um custa 1 chamada de /years)');
const cgs = ['CG 160 Fan', 'CG 160 Titan', 'CG 160 Start', 'CG 125 Fan KS', 'CG 150 Titan ESD', 'CB 300R'].map((name, i) => ({ code: String(i), name }));
ok(acharCandidatosModelo('cg 160 fan', cgs).length === 1, '"CG 160 FAN": 1 candidato em vez de 5');
ok(acharCandidatosModelo('cg', cgs).length === 5, 'só "CG": mantém todos (não inventa versão)');
ok(acharCandidatosModelo('cg150 titan', cgs).map(m => m.name).join() === 'CG 150 Titan ESD', '"CG150" colado: separa letras e número');
ok(acharCandidatosModelo('golf', [{ code: '1', name: 'Gol 1.0' }]).length === 0, '"golf" não casa "gol" (igualdade, não substring)');

console.log('\nCACHE DE RESPOSTAS');
const guardado = new Map();
let reservas = 0;
const cache = { async ler(p) { return guardado.get(p); }, async gravar(p, r) { guardado.set(p, r); } };
const api = {
  '/motorcycles/brands': [{ code: '80', name: 'HONDA' }],
  '/motorcycles/brands/80/models': cgs,
  '/motorcycles/brands/80/models/0/years': [{ code: '2021-1', name: '2021' }],
  '/motorcycles/brands/80/models/0/years/2021-1': { price: 'R$ 12.345,00', codeFipe: '811-1', referenceMonth: 'setembro de 2026' },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const p = String(url).replace('https://fipe.parallelum.com.br/api/v2', '');
  const j = api[p];
  return { ok: !!j, status: j ? 200 : 404, json: async () => j };
};
const fipeGet = criarFipeFetch(async () => { reservas++; return { permitido: true }; }, cache);
const v = { titulo: 'HONDA CG 160 FAN 2021 2021 AZUL', marca: null, modelo: null, ano_fabricacao: 2021, ano_modelo: 2021, tipo_veiculo: 'moto' };
const r1 = await buscarFipe(fipeGet, v);
const gasto1 = reservas;
const r2 = await buscarFipe(fipeGet, { ...v, titulo: 'HONDA CG 160 FAN 2021 2021 PRETA' });
ok(r1.status === 'ok' && r1.valor === 12345, 'veículo sem marca/modelo na fonte recebe FIPE pelo título');
ok(gasto1 === 4, `1º veículo: 4 chamadas (marcas, modelos, anos, preço) — foram ${gasto1}`);
ok(r2.valor === 12345 && reservas === gasto1, 'o mesmo modelo/ano de novo: 0 chamada de cota');
ok((await buscarFipe(fipeGet, { ...v, titulo: 'BOMBA', ano_fabricacao: 2021 })).status === 'sem_dados', 'título sem marca/modelo: sem_dados, sem gastar cota');
api['/motorcycles/brands/80/models/0/years/2020-1'] = { error: 'não encontrado' };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: 'x' }) });
await fipeGet('/qualquer');
ok(!guardado.has('/qualquer'), 'resposta de erro NÃO entra no cache');
globalThis.fetch = realFetch;

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
