/**
 * npm run testar:fipe — marca/modelo pelo título, estreitamento de candidatos e cache de
 * respostas (api/_fipe.js, 24/09). API simulada: nenhum teste aqui gasta cota da FIPE.
 */
import { marcaModeloDoTitulo, acharCandidatosModelo, acharCandidatosModeloAmplo, criarFipeFetch, buscarFipe } from '../../api/_fipe.js';

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
const hondas = ['CG 125 Fan KS', 'CG 125 Titan', 'Biz 100', 'Biz 125 ES'].map((name, i) => ({ code: String(i), name }));
ok(acharCandidatosModelo('fan 125', hondas).map(m => m.name).join() === 'CG 125 Fan KS', '"HONDA FAN 125": acha "CG 125 Fan" pela versão');
ok(acharCandidatosModelo('c 100 biz', hondas).map(m => m.name).join() === 'Biz 100', '"C-100 BIZ": acha "Biz 100"');
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

// ── 30/09: os dois sem_match do print do dono, com os NOMES REAIS da FIPE (fipe_cache) ──
console.log('\n2ª tentativa ampla (nome FIPE que muda com o ano, modelo colado)');
const renault = ['DUSTER OROCH Dyna. 1.6 Flex 16V Mec.', 'DUSTER OROCH Dyna. 2.0 Flex 16V Aut.', 'DUSTER OROCH Express 1.6 Flex 16V Mec.',
  'OROCH Iconic 1.6 Flex 16V Mec.', 'OROCH Intense 1.6 Flex 16V Mec.', 'OROCH Pro 1.6 Flex 16V Mec.', 'DUSTER Dynamique 1.6 Flex 16V Mec.']
  .map((name, i) => ({ code: String(100 + i), name }));
const mb = ['Sprinter 416 Chassi Longo T.B. 2.2 Dies.', 'Sprinter 416 VAN L. T.A. 16L 2.2 Diesel', 'Sprinter 515 CDI Furgão 2.2 Dies.', 'Classe A 200 1.6']
  .map((name, i) => ({ code: String(200 + i), name }));
const oroch = marcaModeloDoTitulo('RENAULT OROCH 1.6 4X2, 2021/2022, Placa FINAL 3 (SP),  (Ref.: DBV)', 'RENAULT');
const primeira = acharCandidatosModelo(oroch.modelo, renault).map((m) => m.name);
ok(primeira.every((n) => /^OROCH/.test(n)), `1ª tentativa só vê os "OROCH …" (2023+): ${primeira.length}`);
const ampla = acharCandidatosModeloAmplo(oroch.modelo, renault, new Set(acharCandidatosModelo(oroch.modelo, renault).map((m) => m.code))).map((m) => m.name);
ok(ampla[0] === 'DUSTER OROCH Dyna. 1.6 Flex 16V Mec.' && ampla.every((n) => /DUSTER OROCH/.test(n)), `ampla acha "DUSTER OROCH" 1.6 primeiro: ${ampla[0]}`);
const sprinter = marcaModeloDoTitulo('MERCEDES BENZ 416CDISPRINTERM, 2020/2021, Placa FINAL 3 (MT),  (Ref.: LIM202600027)', 'MERCEDES');
const sp = acharCandidatosModeloAmplo(sprinter.modelo, mb).map((m) => m.name);
ok(sp.length === 3 && /416/.test(sp[0]) && /416/.test(sp[1]) && !sp.some((n) => /Classe/.test(n)), `"416CDISPRINTERM" colado → Sprinter 416 na frente: ${sp.slice(0, 2).join(' / ')}`);

// ponta a ponta com a API falsa: o Oroch 2021/22 sai com valor (antes: sem_match)
const anosPorModelo = { 100: ['2022 Gasolina', '2021 Gasolina'], 102: ['2021 Gasolina'], 103: ['2024 Gasolina'], 104: ['2024 Gasolina'], 105: ['2024 Gasolina'] };
const falsa = async (path) => {
  if (path === '/cars/brands') return [{ code: '48', name: 'Renault' }];
  if (path === '/cars/brands/48/models') return renault;
  const y = path.match(/models\/(\d+)\/years$/); if (y) return (anosPorModelo[y[1]] || []).map((name, i) => ({ code: `${2021 + i}-1`, name }));
  if (/years\/.+$/.test(path)) return { price: 'R$ 78.500,00', codeFipe: '025291-0', referenceMonth: 'setembro de 2026' };
  return null;
};
const res = await buscarFipe(falsa, { marca: 'RENAULT', modelo: null, titulo: 'RENAULT OROCH 1.6 4X2, 2021/2022', ano_fabricacao: 2021, ano_modelo: 2022, tipo_veiculo: 'carro' });
ok(res.valor === 78500 && res.status === 'aproximado', `Oroch 2021/22 → ${res.status} R$ ${res.valor} (antes: sem_match)`);

console.log('\nmodelo sem marca no título (08/10, "HB20 1.0M UNIQUE - 2019")');
const hb = mm('HB20 1.0M UNIQUE - 2019');
ok(hb?.marca === 'hyundai' && hb.modelo.startsWith('hb20') && hb.modelo.includes('unique'), `HB20 sem marca → hyundai / ${hb?.modelo}`);
ok(mm('ONIX LT 1.0 2020/2021')?.marca === 'chevrolet', 'ONIX sem marca → chevrolet');
ok(mm('Veículo UP TAKE 2016') === null, '"UP" (palavra comum) não vira modelo');
ok(mm('CASA EM BH') === null, 'texto sem modelo conhecido → null');
ok(mm('HB20 1.0M UNIQUE - 2019', 'CITROEN') === null, 'com marca da fonte, o título não inventa outra (decisão fica no buscarFipe)');

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
