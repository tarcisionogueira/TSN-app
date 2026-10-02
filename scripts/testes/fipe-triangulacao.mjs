// npm run testar:fipe-triangulacao — "não podemos ficar sem referência FIPE" (dono, 02/10).
// Lista REAL da FIPE (VW, carros, 2021 flex, recon 02/10) para a Saveiro que dava sem_match.
import assert from 'node:assert/strict';
import { triangularPorAno } from '../../api/_fipe.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const LISTA = [
  { code: '8323', name: 'Gol 1.0 Flex 12V 5p' }, { code: '8324', name: 'Gol 1.6 MSI Flex 8V 5p' },
  { code: '6941', name: 'Saveiro CROSS 1.6 T.Flex 16V CD' }, { code: '7566', name: 'Saveiro Robust 1.6 Total Flex 8V' },
  { code: '7960', name: 'Saveiro Robust 1.6 Total Flex 8V CD' }, { code: '6799', name: 'Saveiro Trendline 1.6 T.Flex 8V' },
];
const PRECO = { 7566: 'R$ 70.100,00', 7960: 'R$ 76.300,00', 6941: 'R$ 86.000,00', 6799: 'R$ 72.000,00', 8323: 'R$ 55.000,00' };
const chamadas = [];
const fipeGet = async (path) => {
  chamadas.push(path);
  if (/\/years\/2021-5\/models$/.test(path)) return LISTA;
  if (/\/years\/\d{4}-\d\/models$/.test(path)) return [];
  const cod = path.match(/models\/(\d+)\/years/)?.[1];
  return cod ? { price: PRECO[cod], codeFipe: `005${cod}-1`, referenceMonth: 'outubro de 2026' } : null;
};

let r = await triangularPorAno(fipeGet, 'cars', 59, { titulo: 'VOLKSWAGEN NOVA SAVEIRO RB MBVS 1.6, 2020/2021, Placa FINAL 3 (SP)', ano_fabricacao: 2020, ano_modelo: 2021 }, 'nova saveiro rb');
assert.ok(r); assert.equal(r.status, 'aproximado'); assert.equal(r.versoes, 2);
assert.equal(r.valor, 73200); assert.deepEqual(r.faixa, [70100, 76300]);
ok('Saveiro "RB" 2021 → só as 2 Robust (RB=Robust), mediana R$ 73.200 com faixa — antes sem_match');

r = await triangularPorAno(fipeGet, 'cars', 59, { titulo: 'VW GOL 1.0 2021/2021', ano_fabricacao: 2021, ano_modelo: 2021 }, 'gol 1 0');
assert.equal(r.status, 'ok'); assert.equal(r.valor, 55000); assert.ok(r.codigoFipe);
ok('Gol 1.0 2021 → versão única pela motorização: FIPE exata');

r = await triangularPorAno(fipeGet, 'cars', 59, { titulo: 'VW AMAROK 2021', ano_fabricacao: 2021, ano_modelo: 2021 }, 'amarok');
assert.equal(r, null); ok('modelo que não existe no ano → null (não inventa valor de outro carro)');
console.log(`\n✓ fipe-triangulacao: ${n} casos`);
